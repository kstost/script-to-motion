#!/usr/bin/env node
/**
 * thumbnail.mjs — a still image from an HTML page you designed (the video's thumbnail, a cover, a card): the same OFL
 * fonts and drawing code as the video, rendered in headless Chromium after the fonts and images are ready.
 *
 *   node thumbnail.mjs <page.html> [--out thumbnail.png] [--size 1280x720]
 *
 * Reports page errors, fonts that didn't load and images that failed. references/youtube-package.md §Thumbnail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, parseArgs } from './lib/browser.mjs';

const opt = parseArgs();
const file = path.resolve(opt._[0] || 'thumbnail.html');
if (!fs.existsSync(file)) { console.error(`✖ no ${file}`); process.exit(2); }
const [w, h] = String(opt.size || '1280x720').split('x').map(Number);
const out = path.resolve(opt.out || path.join(path.dirname(file), 'thumbnail.png'));
const errors = [];
const browser = await launch();
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(pathToFileURL(file).href);
await page.evaluate(() => document.fonts.ready);
const st = await page.evaluate(async () => {
  await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))));
  return { fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')),
    failedFonts: [...document.fonts].filter((f) => f.status === 'error').map((f) => f.family),
    badImages: [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')) };
});
await page.waitForTimeout(200);
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
await browser.close();
for (const e of errors) console.log('✖ ' + e);
for (const f of st.failedFonts) console.log('✖ font failed to load: ' + f);
for (const i of st.badImages) console.log('✖ image failed: ' + i);
console.log(`${path.relative(process.cwd(), out)} · ${w}×${h} · fonts: ${[...new Set(st.fonts)].join(', ') || 'none'}`);
process.exit(errors.length || st.failedFonts.length || st.badImages.length ? 1 : 0);
