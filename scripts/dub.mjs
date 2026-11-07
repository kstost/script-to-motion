#!/usr/bin/env node
/**
 * dub.mjs — a dubbed audio track in another language, the same length as the video, for YouTube's audio tracks
 * (references/sound.md §Dub). The other language's narration is recorded with the same voice, each line is placed where
 * the original line starts, and the footage's own sound is mixed in exactly as the player plays it.
 *
 *   node dub.mjs <projectDir> --lang en --init         dub/en/script.json from subs.json's translations (voice, model and
 *                                                       settings copied; say = text): then write the spoken forms in `say`
 *   node tts.mjs <projectDir>/dub/en                    silent placeholders with estimated timing, no API call: --report
 *                                                       then shows the estimated fit before anything is recorded
 *   node tts.mjs <projectDir>/dub/en --approved         record the takes, once the user decided to record the dub (their
 *                                                       key and voice from the skill's .env, model drama-3)
 *   node dub.mjs <projectDir> --lang en --report        how each take fits its room; writes nothing (--json: every line)
 *   node dub.mjs <projectDir> --lang en [--out file.wav]   → dub/en/<name>.en.wav (48 kHz stereo) — recorded takes only:
 *                                                       refused while a line is a placeholder or its take is stale
 *
 * The room for a line: from its original start to the next line's start (−0.12 s), but never into the footage's own sound
 * (dialogue) that comes up after the original line ended. A take that doesn't fit may start up to 0.3 s early (when the
 * air there is free). Every take plays exactly as it was recorded — the voice is never slowed down or sped up (no
 * time-stretch here, no TTS speed in tts.mjs): a line longer than its room is refused, reword it shorter. --report also
 * lists lines that leave ≥ 0.66 s of air: lengthen their wording.
 * The narration is level-matched to the original narration, then compressed, normalised to −16 LUFS and limited at −2 dBFS.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
import { launch, openPage, parseArgs } from './lib/browser.mjs';

const opt = parseArgs();
const dir = path.resolve(opt._[0] || '.');
const lang = opt.lang;
if (!lang) { console.error('✖ --lang <code> is required (e.g. --lang en)'); process.exit(2); }
if (opt.max != null || opt.min != null) { console.error('✖ --max / --min are gone: the voice is never slowed down or sped up — reword a line that does not fit its room (--report lists them)'); process.exit(2); }
const DUB = path.join(dir, 'dub', lang);

if (opt.init) {
  const src = JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8'));
  const subs = fs.existsSync(path.join(dir, 'subs.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'subs.json'), 'utf8')) : {};
  const tr = (subs.translations || {})[lang];
  if (!tr) { console.error(`✖ no translations.${lang} in subs.json — write the translation there first (subs.mjs uses it too)`); process.exit(2); }
  const missing = src.cues.filter((c) => !tr[c.id]).map((c) => c.id);
  if (missing.length) { console.error(`✖ ${lang}: no translation for ${missing.join(', ')}`); process.exit(2); }
  if (fs.existsSync(path.join(DUB, 'script.json')) && !opt.force) { console.error(`✖ ${path.relative(process.cwd(), DUB)}/script.json exists (--force to overwrite)`); process.exit(2); }
  const keep = ['voice', 'model', 'temperature', 'top_p', 'leadIn', 'gap', 'tail'];   // same voice and model (drama-3)
  const out = { title: `${src.title || ''} (${lang} dub)`, lang, narration: true };
  for (const k of keep) if (src[k] != null) out[k] = src[k];
  out.cues = src.cues.map((c) => ({ id: c.id, text: tr[c.id], say: tr[c.id] }));
  fs.mkdirSync(DUB, { recursive: true });
  fs.writeFileSync(path.join(DUB, 'script.json'), JSON.stringify(out, null, 1));
  const rel = path.relative(process.cwd(), DUB);
  console.log(`${rel}/script.json: ${out.cues.length} cues. Write numbers, symbols and names as they are spoken in "say" (Kling 4.0 → "Kling four point oh", 1080p → "ten-eighty p"), keep tags sparse. Then node tts.mjs ${rel} (silent placeholders, no API call) and dub.mjs --lang ${lang} --report for the estimated fit; the takes are recorded only when the user decides to: node tts.mjs ${rel} --approved`);
  process.exit(0);
}

const noTool = ['ffmpeg', 'ffprobe'].filter((t) => spawnSync(t, ['-version'], { stdio: 'ignore' }).error);
if (noTool.length) { console.error(`✖ ${noTool.join(' and ')} not found — dub.mjs measures and mixes the takes with ${noTool.length > 1 ? 'them' : 'it'}. Install ffmpeg (Mac: brew install ffmpeg; ffprobe comes with it), then run it again. Nothing was written.`); process.exit(2); }

const dubScript = JSON.parse(fs.readFileSync(path.join(DUB, 'script.json'), 'utf8'));
const rel = path.relative(process.cwd(), DUB);
// only recorded, current takes make a track: a placeholder is silence, a stale take says the old wording
if (!fs.existsSync(path.join(DUB, 'js', 'cues.js'))) { console.error(`✖ no ${lang} takes yet — run tts.mjs ${rel} (placeholders for --report), and record with --approved once the user decided to record the dub`); process.exit(1); }
const dubBox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(DUB, 'js', 'cues.js'), 'utf8'), dubBox);
const dubData = dubBox.window.VIDEO_DATA;
if (dubData.narration === false || dubScript.narration === false) { console.error(`✖ ${rel} is "narration": false — a dub track is recorded narration: set "narration": true in its script.json, run tts.mjs ${rel}, and record with --approved once the user decided to`); process.exit(1); }
const said = new Map(dubData.cues.map((c) => [c.id, c.say]));
const stale = [...dubScript.cues.filter((c) => said.get(c.id) !== c.say).map((c) => c.id),
  ...dubData.cues.filter((c) => !dubScript.cues.some((d) => d.id === c.id)).map((c) => c.id)];
if (stale.length) { console.error(`✖ the ${lang} takes are stale: "say" in ${rel}/script.json changed since tts.mjs ran (${stale.join(', ')}) — run tts.mjs ${rel} again (unchanged lines come from the cache; changed lines are recorded with --approved once the user decided to)`); process.exit(1); }
const ph = dubData.cues.filter((c) => c.placeholder || (dubData.placeholder && !dubData.cues.some((d) => 'placeholder' in d))).map((c) => c.id);
if (ph.length && !opt.report) { console.error(`✖ ${ph.length} ${lang} line(s) are silent placeholders, not recorded (${ph.join(', ')}) — the track would be silent there. Record them once the user decided to record the dub: node tts.mjs ${rel} --approved`); process.exit(1); }
const GAP = 0.12, EARLY = 0.3;
const LUFS = -16, LIMIT = 0.79;

const browser = await launch();
const page = await openPage(browser, dir);
const info = await page.evaluate(() => ({ dur: window.__video.duration, audio: window.__media ? window.__media.audio() : [],
  cues: window.VIDEO_DATA.cues.map((c) => ({ id: c.id, start: c.start, end: c.end })) }));
await browser.close();

const decode = (file, sr, ch, ss, dur, af) => {
  const a = ['-v', 'error'];
  if (ss) a.push('-ss', String(ss));
  a.push('-i', file);
  if (dur) a.push('-t', String(dur));
  if (af) a.push('-af', af);
  a.push('-f', 'f32le', '-ac', String(ch), '-ar', String(sr), '-');
  const buf = execFileSync('ffmpeg', a, { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
};
const volAt = (v, lt) => {
  if (typeof v === 'number') return v;
  if (lt <= v[0][0]) return v[0][1];
  for (let i = 1; i < v.length; i++) if (lt <= v[i][0]) { const [x0, a] = v[i - 1], [x1, b] = v[i]; return a + ((b - a) * (lt - x0)) / Math.max(1e-6, x1 - x0); }
  return v[v.length - 1][1];
};
const mixInto = (mix, ch, sr, pcm, at, gain) => {
  const o = Math.round(at * sr) * ch;
  for (let i = 0; i < pcm.length && o + i < mix.length; i++) if (o + i >= 0) mix[o + i] += pcm[i] * (typeof gain === 'function' ? gain(Math.floor(i / ch) / sr) : gain);
};
const clipsInto = (mix, ch, sr) => {
  for (const c of info.audio) {
    const pcm = decode(path.resolve(dir, c.file), sr, ch, c.in, c.dur).subarray(0, Math.round(c.dur * sr) * ch);   // clips with sound play at rate 1 (media.js)
    mixInto(mix, ch, sr, pcm, c.start, (lt) => volAt(c.vol, lt));
  }
};

// where the footage's own sound is up (20 ms windows over −36 dBFS, after its envelopes): narration must not run into it
const SRM = 16000, W = SRM / 50;
const clipMono = new Float32Array(Math.ceil(info.dur * SRM));
clipsInto(clipMono, 1, SRM);
const loud = [];
for (let i = 0; i + W <= clipMono.length; i += W) {
  let s = 0;
  for (let j = 0; j < W; j++) s += clipMono[i + j] ** 2;
  loud.push(Math.sqrt(s / W) > 10 ** (-36 / 20));
}
const firstLoud = (a, b) => {
  for (let k = Math.max(0, Math.ceil(a * 50)); k < Math.min(loud.length, b * 50); k++) if (loud.slice(k, k + 5).every(Boolean)) return k / 50;
  return null;
};

const durOf = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' });
const missing = info.cues.filter((c) => !fs.existsSync(path.join(DUB, 'audio', 'cues', `${c.id}.wav`))).map((c) => c.id);
if (missing.length) { console.error(`✖ no ${lang} take for ${missing.join(', ')} — add the line to ${rel}/script.json and run tts.mjs ${rel} (--approved once the user decided to record the dub)`); process.exit(1); }
let prevEnd = 0;
const plan = info.cues.map((c, i) => {
  const next = i + 1 < info.cues.length ? info.cues[i + 1].start : info.dur;
  let end = next - GAP;
  const clip = firstLoud(c.end + 0.05, end);
  if (clip != null) end = Math.max(c.end, clip - 0.08);
  const file = path.join(DUB, 'audio', 'cues', `${c.id}.wav`);
  const d = durOf(file);
  let start = c.start;
  if (d > end - start) {
    const from = Math.max(c.start - EARLY, prevEnd + GAP);
    if (from < start && firstLoud(from, c.start) == null) start = from;
  }
  prevEnd = start + d;
  const over = d - (end - start), air = (clip != null ? end + 0.08 : end + GAP) - prevEnd;   // over > 0: runs past its room
  return { id: c.id, file, start, room: end - start, d, over, air, byClip: clip != null };
});
const long = plan.filter((p) => p.over > 0.0005), airy = plan.filter((p) => p.air >= 0.66 && p.id !== plan[plan.length - 1].id);
if (opt.report) {
  if (opt.json) { console.log(JSON.stringify(plan.map(({ id, start, room, d, over, air }) => ({ id, start, room, d, over, air, ...(ph.includes(id) ? { placeholder: true } : {}) })))); process.exit(0); }
  for (const p of long) console.log(`${p.id.padEnd(8)} take ${p.d.toFixed(2)} s · room ${p.room.toFixed(2)} s${p.byClip ? ' (footage sound)' : ''} → ${p.over.toFixed(2)} s too long  ✖ reword shorter`);
  for (const p of airy) console.log(`${p.id.padEnd(8)} take ${p.d.toFixed(2)} s · room ${p.room.toFixed(2)} s → leaves ${p.air.toFixed(2)} s of air  (lengthen the wording)`);
  console.log(`${long.length} of ${plan.length} lines too long for their room · ${airy.length} leave ≥ 0.66 s of air`);
  if (ph.length) console.log(`⏸ ${ph.length} line(s) are placeholders, not recorded — their lengths are estimates: ${ph.join(', ')}`);
  process.exit(0);
}
if (long.length) { console.error(`✖ too long for their room: ${long.map((p) => `${p.id} +${p.over.toFixed(2)} s`).join(', ')} — reword them shorter in ${path.relative(process.cwd(), DUB)}/script.json (the voice is never sped up)`); process.exit(1); }

// narration level-matched to the original narration, then the footage, then mastering
const SR = 48000, CH = 2;
const narr = new Float32Array(Math.ceil(info.dur * SR) * CH);
for (const p of plan) mixInto(narr, CH, SR, decode(p.file, SR, CH, 0, 0), p.start, 1);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dub-'));
const narrFile = path.join(tmp, 'narr.f32');
fs.writeFileSync(narrFile, Buffer.from(narr.buffer));
const loudness = (inArgs, af = '') => {
  const e = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...inArgs, '-af', `${af}ebur128`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr;
  return +/I:\s+(-?[\d.]+) LUFS/.exec(e.slice(e.lastIndexOf('Summary')))[1];
};
const origI = loudness(['-i', path.join(dir, 'audio/narration.wav')]);
const dubI = loudness(['-f', 'f32le', '-ar', String(SR), '-ac', String(CH), '-i', narrFile]);
const g = 10 ** ((origI - dubI) / 20);
const mix = new Float32Array(narr.length);
for (let i = 0; i < mix.length; i++) mix[i] = narr[i] * g;
clipsInto(mix, CH, SR);
const mixFile = path.join(tmp, 'mix.f32');
fs.writeFileSync(mixFile, Buffer.from(mix.buffer));
const raw = ['-f', 'f32le', '-ar', String(SR), '-ac', String(CH), '-i', mixFile];
const COMP = 'acompressor=threshold=0.1:ratio=3:attack=5:release=150:knee=4';
const measI = loudness(raw, `${COMP},`);
const MASTER = `${COMP},volume=${(LUFS - measI).toFixed(2)}dB,alimiter=limit=${LIMIT}:attack=5:release=80:level=false`;
const OUT = path.resolve(dir, opt.out || path.join('dub', lang, `${opt.name || 'video'}.${lang}.wav`));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
execFileSync('ffmpeg', ['-v', 'error', '-y', ...raw, '-af', MASTER, '-t', info.dur.toFixed(3), '-c:a', 'pcm_s16le', '-ar', String(SR), OUT]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${lang} narration ${dubI.toFixed(1)} → ${origI.toFixed(1)} LUFS (the original narration's level) · every line at its recorded speed`);
if (airy.length) console.log(`⚠ ${airy.length} lines leave ≥ 0.66 s of air: ${airy.map((p) => p.id).join(', ')} — dead air (references/sound.md); lengthen their wording`);
console.log(`→ ${path.relative(process.cwd(), OUT)} · ${info.dur.toFixed(3)} s · 48 kHz stereo 16-bit · ${LUFS} LUFS`);
