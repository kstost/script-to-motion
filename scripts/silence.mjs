#!/usr/bin/env node
/**
 * silence.mjs — dead air in the finished sound. Mixes what the viewer hears — audio/narration.wav plus every clip's own
 * sound at its placement and volume envelope (js/media.js) — and lists every stretch where all 20 ms windows stay under
 * the threshold (room tone too quiet to hear counts as silence). Each stretch is tagged with the cue it follows and,
 * when it lies inside a playing clip, with that clip: pauses inside footage the user wants kept whole are allowed
 * (references/sound.md); everything else is dead air to fix (gapAfter, chapter windows, a line laid over a clip's
 * silent tail).
 *
 *   node silence.mjs <projectDir> [--min 0.7] [--db -42]
 *
 * Exit code 1 when dead air outside the clips is found. Needs ffmpeg. No video is rendered.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, openPage, parseArgs } from './lib/browser.mjs';

const opt = parseArgs();
const dir = path.resolve(opt._[0] || '.');
const MIN = +(opt.min || 0.7), DB = +(opt.db || -42);
const browser = await launch();
const page = await openPage(browser, dir);
const info = await page.evaluate(() => ({ dur: window.__video.duration, audio: window.__media ? window.__media.audio() : [],
  cues: window.VIDEO_DATA.cues.map((c) => [c.id, c.start, c.end]), audioFile: window.VIDEO_DATA.audio,
  silent: window.VIDEO_DATA.narration === false || !!window.VIDEO_DATA.placeholder }));
await browser.close();
if (info.silent && !info.audio.length) {
  console.log('no recorded narration and no clip sound (narration: false or placeholder) — nothing to check yet');
  process.exit(0);
}
if (info.silent) console.log('⚠ narration is silent (narration: false or placeholder): only the clips\' sound is checked — expect gaps between them');

const SR = 16000, mix = new Float32Array(Math.ceil(info.dur * SR));
const decode = (file, ss, dur) => {
  const a = ['-v', 'error'];
  if (ss) a.push('-ss', String(ss));
  a.push('-i', file);
  if (dur) a.push('-t', String(dur));
  a.push('-f', 'f32le', '-ac', '1', '-ar', String(SR), '-');
  const buf = execFileSync('ffmpeg', a, { maxBuffer: 1 << 30 });
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
add(decode(path.join(dir, 'audio/narration.wav')), 0, () => 1);
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
  if (b - a >= MIN) {
    const clip = inside(a, b);
    if (clip) kept++; else { dead++; total += b - a; }
    console.log(`${clip ? '  ' : '✖ '}${fmt(a)} – ${fmt(b)}  ${(b - a).toFixed(2)} s  (after ${after(a)})${clip ? `  inside clip ${clip.key}` : ''}`);
  }
  k = e;
}
console.log(`${dead} stretch(es) of dead air ≥ ${MIN} s outside the clips (${total.toFixed(1)} s) · ${kept} inside clips · under ${DB} dBFS · timeline ${info.dur.toFixed(2)} s`);
process.exit(dead ? 1 : 0);
