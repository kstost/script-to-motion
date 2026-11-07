#!/usr/bin/env node
/**
 * silence.mjs — dead air in the finished sound. Mixes what the viewer hears — audio/narration.wav plus every clip's own
 * sound at its placement and volume envelope (js/media.js) — and lists every stretch where all 20 ms windows stay under
 * the threshold (room tone too quiet to hear counts as silence). Each stretch is tagged with the cue it follows and,
 * when it lies inside a playing clip, with that clip: pauses inside footage the user wants kept whole are allowed
 * (references/sound.md); everything else is dead air to fix (gapAfter, chapter windows, a line laid over a clip's
 * silent tail).
 *
 * Not dead air: the END HOLD — from the last sound to the video's end (the `tail`, the last frame holding) is reported
 * as an info line. Placeholder cues (placeholder: true in js/cues.js: silent, not recorded yet) count as sound, so the
 * gaps around them are still checked; they are listed as not checked.
 *
 *   node silence.mjs <projectDir> [--min 0.7] [--db -42]
 *
 * Exit code 1 when dead air outside the clips is found, 2 when the sound can't be checked (no ffmpeg, a file that
 * doesn't decode). Needs ffmpeg. No video is rendered.
 */
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { launch, openPage, parseArgs } from './lib/browser.mjs';

const opt = parseArgs();
const dir = path.resolve(opt._[0] || '.');
const MIN = +(opt.min || 0.7), DB = +(opt.db || -42);
if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).error) {
  console.error('✖ ffmpeg not found — silence.mjs decodes the narration and the clips\' sound with it. Install ffmpeg (Mac: brew install ffmpeg), then run it again. Nothing was checked.');
  process.exit(2);
}
const browser = await launch();
const page = await openPage(browser, dir);
const info = await page.evaluate(() => ({ dur: window.__video.duration, audio: window.__media ? window.__media.audio() : [],
  cues: window.VIDEO_DATA.cues.map((c) => [c.id, c.start, c.end, !!c.placeholder]), audioFile: window.VIDEO_DATA.audio,
  narration: window.VIDEO_DATA.narration !== false, tail: window.VIDEO_DATA.tail,
  // js/cues.js from before per-cue flags: placeholder only at the top level
  legacy: !!window.VIDEO_DATA.placeholder && !window.VIDEO_DATA.cues.some((c) => 'placeholder' in c) }));
await browser.close();
if (!info.narration && !info.audio.length) {
  console.log('no narration (narration: false) and no clip sound — nothing to check');
  process.exit(0);
}
if (!info.narration) console.log('⚠ no narration (narration: false): only the clips\' sound is checked — expect gaps between them');

const SR = 16000, mix = new Float32Array(Math.ceil(info.dur * SR));
const decode = (file, ss, dur) => {
  const a = ['-v', 'error'];
  if (ss) a.push('-ss', String(ss));
  a.push('-i', file);
  if (dur) a.push('-t', String(dur));
  a.push('-f', 'f32le', '-ac', '1', '-ar', String(SR), '-');
  let buf;
  try {
    buf = execFileSync('ffmpeg', a, { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    console.error(`✖ ffmpeg could not decode ${path.relative(dir, file) || file}: ${String(err.stderr || err.message).trim().split('\n').pop()} — nothing was checked`);
    process.exit(2);
  }
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
};
const volAt = (v, lt) => {
  if (typeof v === 'number') return v;
  if (lt <= v[0][0]) return v[0][1];
  for (let i = 1; i < v.length; i++) if (lt <= v[i][0]) { const [x0, a] = v[i - 1], [x1, b] = v[i]; return a + ((b - a) * (lt - x0)) / Math.max(1e-6, x1 - x0); }
  return v[v.length - 1][1];
};
const add = (pcm, at, gain) => {
  const o = Math.round(at * SR);
  for (let i = 0; i < pcm.length && o + i < mix.length; i++) if (o + i >= 0) mix[o + i] += pcm[i] * gain(i / SR);
};
const narration = decode(path.join(dir, 'audio/narration.wav'));
add(narration, 0, () => 1);
for (const c of info.audio) {
  const pcm = decode(path.resolve(dir, c.file), c.in, c.dur * c.rate).subarray(0, Math.round(c.dur * SR));
  add(pcm, c.start, (lt) => volAt(c.vol, lt));
}

const W = SR / 50, thr = Math.pow(10, DB / 20);
const quiet = [];
for (let i = 0; i + W <= mix.length; i += W) {
  let s = 0;
  for (let j = 0; j < W; j++) s += mix[i + j] * mix[i + j];
  quiet.push(Math.sqrt(s / W) < thr);
}
// placeholder cues: silent until recorded — their windows count as sound, so only the gaps around them are judged
const isPlaceholder = ([, s, e, ph]) => {
  if (ph || !info.legacy) return ph;
  let p = 0;   // old js/cues.js: a placeholder is a cue whose own window of narration.wav is digital silence
  for (let i = Math.floor(s * SR); i < Math.min(narration.length, e * SR); i++) p = Math.max(p, Math.abs(narration[i]));
  return p < 1e-4;
};
const placeholders = info.cues.filter(isPlaceholder);
for (const [, s, e] of placeholders) for (let k = Math.floor(s * 50); k < Math.min(quiet.length, Math.ceil(e * 50)); k++) quiet[k] = false;
const after = (t) => { let id = '—'; for (const [cid, s] of info.cues) if (s <= t + 0.01) id = cid; return id; };
// inside footage: every moment of the stretch lies inside some playing clip (back-to-back clips count as one) → the clips' keys
const inside = (a, b) => {
  const keys = new Set();
  for (let t = a + 0.01; t < b - 0.01; t += 0.02) {
    const c = info.audio.find((x) => x.start <= t && x.start + x.dur >= t);
    if (!c) return null;
    keys.add(c.key);
  }
  return { key: [...keys].join(' → ') };
};
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
let dead = 0, kept = 0, total = 0;
for (let k = 0; k < quiet.length;) {
  if (!quiet[k]) { k++; continue; }
  let e = k;
  while (e < quiet.length && quiet[e]) e++;
  const a = k / 50, b = e / 50;
  if (e === quiet.length && k > 0) {   // from the last sound to the end: the end hold, not dead air
    console.log(`· ${fmt(a)} – ${fmt(info.dur)}  ${(info.dur - a).toFixed(2)} s  end hold (after ${after(a)}) — the last frame holds after the last sound (tail ${info.tail} s); not dead air`);
  } else if (b - a >= MIN) {
    const clip = inside(a, b);
    if (clip) kept++; else { dead++; total += b - a; }
    console.log(`${clip ? '  ' : '✖ '}${fmt(a)} – ${fmt(b)}  ${(b - a).toFixed(2)} s  (after ${after(a)})${clip ? `  inside clip ${clip.key}` : ''}`);
  }
  k = e;
}
if (placeholders.length) console.log(`⏸ ${placeholders.length} placeholder cue(s) not checked (silent until recorded; the gaps around them are): ${placeholders.map(([id]) => id).join(', ')} — run again after recording`);
console.log(`${dead} stretch(es) of dead air ≥ ${MIN} s outside the clips (${total.toFixed(1)} s) · ${kept} inside clips · under ${DB} dBFS · timeline ${info.dur.toFixed(2)} s`);
process.exit(dead ? 1 : 0);
