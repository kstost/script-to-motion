#!/usr/bin/env node
/**
 * stills.mjs — the footage frames the review tools see. Headless Chromium has no H.264 decoder, so in review mode
 * (?stills — snapshot.mjs, check_fonts.mjs, errscan.mjs) js/media.js shows pre-extracted JPEG frames instead of <video>.
 * This cuts them: for every clip placement (MEDIA.clip), <out>/<placement id>/00001.jpg … at <fps>, cropped and scaled
 * like the placement, from the clip's master (js/media-src.js). Placements already cut are kept.
 *
 *   node stills.mjs <projectDir> [--out media/stills] [--fps 10] [--scale 0.5] [--jobs 6]
 *
 * Re-run after adding or moving a placement. Needs ffmpeg. references/footage.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { launch, openPage, run, pool, parseArgs } from './lib/browser.mjs';

const opt = parseArgs();
const dir = path.resolve(opt._[0] || '.');
const OUT = path.resolve(dir, opt.out || 'media/stills');
const FPS = +(opt.fps || 10), SCALE = +(opt.scale || 0.5), JOBS = +(opt.jobs || 6);

const browser = await launch();
const page = await openPage(browser, dir);
const list = await page.evaluate(() => (window.__media ? window.__media.list() : []));
await browser.close();
const uniq = [...new Map(list.map((m) => [m.id, m])).values()];
if (!uniq.length) { console.log('no clip placements (js/media.js) — nothing to cut'); process.exit(0); }
console.log(`${uniq.length} placements → ${path.relative(process.cwd(), OUT) || '.'} (${FPS} fps, scale ${SCALE})`);
fs.mkdirSync(OUT, { recursive: true });
let done = 0;
const missing = new Set();
await pool(uniq, JOBS, async (m) => {
  const master = path.resolve(dir, m.master);
  if (!fs.existsSync(master)) { missing.add(m.master); done++; return; }
  const d = path.join(OUT, m.id), n = Math.max(1, Math.ceil(m.dur * FPS - 1e-6));
  if (fs.existsSync(d) && fs.readdirSync(d).length >= n) { done++; return; }
  fs.mkdirSync(d, { recursive: true });
  const [cx, cy, cw, ch] = m.crop.map((v) => Math.round(v));
  const wpx = Math.max(64, Math.round((m.res * SCALE) / 2) * 2);
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(m.in), '-i', master, '-vf',
    `crop=${cw}:${ch}:${cx}:${cy},scale=${wpx}:-2:flags=lanczos,setpts=(PTS-STARTPTS)/${m.rate},fps=${FPS},tpad=stop_mode=clone:stop=${n}`,
    '-frames:v', String(n), '-q:v', '3', path.join(d, '%05d.jpg')]);
  done++;
  if (done % 5 === 0 || done === uniq.length) console.log(`  ${done}/${uniq.length}`);
});
if (missing.size) console.log(`⚠ skipped — master not found: ${[...missing].join(', ')}`);
console.log('stills ready');
