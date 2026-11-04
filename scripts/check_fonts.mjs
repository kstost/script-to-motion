#!/usr/bin/env node
/**
 * check_fonts.mjs — prove that every glyph on screen is drawn with an installed SIL OFL 1.1 catalogue font.
 *
 *   node check_fonts.mjs <projectDir> [--step 0]   (0 = sample each cue's middle and end; N = every N s)
 *
 * Why: a system font (system-ui, Menlo, SF Mono, Consolas, Apple SD Gothic Neo, Malgun Gothic…) renders
 * differently on the recording machine than in the verification, and some system fonts carry
 * licences that don't cover a published video. The rule in this skill: only fonts shipped in
 * <project>/fonts/ with their licence files (SIL OFL 1.1, unmodified).
 *
 * 1. Static: every @font-face is a family from the skill's font catalogue (assets/fonts/catalog.json), its file
 *    is the catalogue's unmodified file (sha256), its licence file is present, and no CSS / JS / HTML font
 *    declaration names anything but installed catalogue families + CSS generics.
 * 2. Runtime (headless Chromium, the same browser as snapshot.mjs): seek through the video with captions on,
 *    and for every visible element ask the engine (CDP CSS.getPlatformFontsForNode) which font files
 *    actually rendered its text. Any non-web ("platform") font fails, with the text and the time.
 *
 * 3. Type that is not DOM text (TypeFX): glyph outlines in js/glyphs.js must come from installed catalogue font
 *    files (sha256), and every text drawn on a canvas with TX.raster must name a catalogue family that covers
 *    every character (no glyph may fall back to a system font).
 *
 * Exit code 1 on any failure. Needs a browser: node setup_browser.mjs (same as snapshot.mjs).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { auditFonts, stackProblems } from './lib/fonts.mjs';
import { auditGlyphs, familiesOf, uncovered } from './lib/glyphs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = { _: [] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  else opt._.push(argv[i]);
}
const dir = path.resolve(opt._[0] || '.');
if (!fs.existsSync(path.join(dir, 'index.html'))) { console.error(`no index.html in ${dir}`); process.exit(2); }

const fails = [];
const notes = [];
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

// ---------- 1. static (catalogue: family allowed, file unmodified, licence present, no stray names) ----------
const fa = auditFonts(dir);
fails.push(...fa.errors);
for (const b of stackProblems(dir, fa.families)) fails.push(`${b} is not an installed catalogue font — use a catalogued font (add_font.mjs --list) + a generic fallback`);
notes.push(`SIL OFL 1.1 fonts installed in this project (catalogue + fonts.lock.json): ${[...fa.used].join(', ') || '(none)'}`);

// ---------- 2. runtime ----------
let chromium;
try { ({ chromium } = await import('playwright-core')); } catch {
  console.error(`playwright-core is not installed. Run once:\n  node ${path.join(here, 'setup_browser.mjs')}`); process.exit(3);
}
function browserConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.cache', 'motion-video-deps', 'browser.json'), 'utf8'));
    if (c.executablePath && fs.existsSync(c.executablePath)) return c;
  } catch { /* none yet */ }
  return null;
}
const cfg = browserConfig();
const env = { ...process.env };
if (cfg && cfg.libDirs && cfg.libDirs.length) env.LD_LIBRARY_PATH = [...cfg.libDirs, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
let browser;
try { browser = await chromium.launch({ env, ...(cfg ? { executablePath: cfg.executablePath } : {}) }); } catch (e) {
  console.error('✖ no working browser yet. Run once: node ' + path.join(here, 'setup_browser.mjs')); process.exit(4);
}
const W = Number((read('index.html').match(/data-width="(\d+)"/) || [])[1] || 1920);
const H = Number((read('index.html').match(/data-height="(\d+)"/) || [])[1] || 1080);
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
// every text any canvas draws, with the font it was drawn in (the DOM check below can't see inside a canvas)
await page.addInitScript(() => {
  const seen = new Map();
  window.__canvasText = seen;
  for (const C of [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D]) {
    if (!C) continue;
    for (const m of ['fillText', 'strokeText']) {
      const orig = C.prototype[m];
      C.prototype[m] = function (text, ...rest) {
        const f = String(this.font), k = f + '\u0000' + text;
        if (seen.size < 20000 && !seen.has(k)) seen.set(k, { font: f, text: String(text) });
        return orig.call(this, text, ...rest);
      };
    }
  }
});
await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + '?captions');
await page.addStyleTag({ content: '.vp-start { display: none !important; }' });
await page.waitForFunction(() => document.body.classList.contains('vp-ready') || document.querySelector('.vp-error'), null, { timeout: 30000 });
const cdp = await page.context().newCDPSession(page);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '#stage *' });
const info = await page.evaluate(() => ({ duration: window.__video.duration, cues: window.VIDEO_DATA.cues.map((c) => [c.start, c.end]) }));
const step = Number(opt.step || 0);
const times = step > 0
  ? Array.from({ length: Math.floor(info.duration / step) + 1 }, (_, i) => +(i * step).toFixed(2))
  : [0.2, ...info.cues.flatMap(([a, b]) => [(a + b) / 2, Math.max(a, b - 0.1)]), info.duration - 0.05];
const used = new Map();       // family → { custom, glyphs }
const platform = new Map();   // family → [{ t, text }]
for (const t of times) {
  await page.evaluate((tt) => window.__video.seek(tt), t);
  const idx = await page.evaluate(() => [...document.querySelectorAll('#stage *')].map((el, i) => {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) return -1;
    const vis = el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
    return vis ? i : -1;
  }).filter((i) => i >= 0));
  for (const i of idx) {
    const nodeId = nodeIds[i];
    if (!nodeId) continue;
    let res;
    try { res = await cdp.send('CSS.getPlatformFontsForNode', { nodeId }); } catch { continue; }
    for (const f of res.fonts || []) {
      const u = used.get(f.familyName) || { custom: f.isCustomFont, glyphs: 0 };
      u.glyphs += f.glyphCount; used.set(f.familyName, u);
      if (!f.isCustomFont) {
        const text = await page.evaluate((j) => document.querySelectorAll('#stage *')[j].textContent.trim().slice(0, 40), i);
        const list = platform.get(f.familyName) || [];
        if (list.length < 5) list.push({ t, text });
        platform.set(f.familyName, list);
      }
    }
  }
}
// ---------- 3. type that is not DOM text (TypeFX outlines and canvas text) ----------
const typefx = await page.evaluate(() => window.__typefx || { rasters: [], glyphs: [] });
const canvasText = await page.evaluate(() => (window.__canvasText ? [...window.__canvasText.values()] : []));
await browser.close();
const ga = auditGlyphs(dir);
fails.push(...ga.errors);
const gl = Object.values(ga.entries);
if (gl.length) notes.push(`glyph outlines: ${gl.map((e) => `"${e.text.replace(/\n/g, ' ').slice(0, 16)}" (${e.font.family} ${e.weight})`).join(', ')} — from the installed, unmodified font files`);
for (const r of typefx.rasters || []) {
  const fams = familiesOf(r.family || r.font);
  const first = fams.find((f) => !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|emoji)$/i.test(f));
  if (!first || !fa.families.has(first.toLowerCase())) { fails.push(`canvas text "${r.text.slice(0, 30)}" uses font "${r.family || r.font}" — name an installed catalogue family (TX.raster({ family: "'Pretendard'" }))`); continue; }
  const cov = await uncovered(dir, fams, r.text);
  if (cov.skipped) { fails.push(`canvas text "${r.text.slice(0, 30)}" could not be checked (${cov.skipped}) — npm install in the skill's scripts folder`); continue; }
  if (cov.unknown && cov.unknown.length) fails.push(`canvas text "${r.text.slice(0, 30)}": ${cov.unknown.join(', ')} is not a catalogue font`);
  if (cov.missing.length) fails.push(`canvas text "${r.text.slice(0, 30)}": ${fams.join(', ')} has no glyph for ${cov.missing.map((c) => JSON.stringify(c)).join(' ')} — the canvas would draw them with a system font`);
  else notes.push(`canvas text "${r.text.replace(/\n/g, ' ').slice(0, 24)}" (${first} ${r.weight || ''}) — every character covered`);
}
// every canvas fillText/strokeText seen during the sweep: its font must name an installed family that covers each character
{
  const byFont = new Map();
  for (const { font, text } of canvasText) {
    const e = byFont.get(font) || { chars: new Set(), sample: text };
    for (const ch of text) if (ch.trim()) e.chars.add(ch);
    byFont.set(font, e);
  }
  for (const [font, e] of byFont) {
    if (!e.chars.size) continue;
    const fams = familiesOf(font);
    const first = fams.find((f) => !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|emoji|math|fangsong)$/i.test(f));
    const sample = e.sample.slice(0, 30);
    if (!first || !fa.families.has(first.toLowerCase())) {
      fails.push(`canvas text "${sample}" is drawn in "${font}" — ${first ? `"${first}" is not an installed catalogue font` : 'no font named (the canvas default is a system font)'}: set ctx.font = "<size>px 'Pretendard', sans-serif" (an installed SIL OFL 1.1 family first)`);
      continue;
    }
    const cov = await uncovered(dir, fams, [...e.chars].join(''));
    if (cov.skipped) { fails.push(`canvas text in "${font}" could not be checked (${cov.skipped}) — npm install in the skill's scripts folder`); continue; }
    if (cov.missing.length) fails.push(`canvas text "${sample}" (${font}): no installed font has ${cov.missing.map((c) => JSON.stringify(c)).join(' ')} — the canvas would draw them with a system font`);
  }
  if (byFont.size) notes.push(`canvas text: ${byFont.size} font setting(s) checked character by character`);
}
for (const [fam, list] of platform) {
  fails.push(`platform font "${fam}" rendered on screen — e.g. ${list.map((x) => `t=${x.t.toFixed(2)} "${x.text}"`).join(' · ')}. ` +
    'An installed catalogue font lacks these glyphs or a stack names a system font: change the text, or install an SIL OFL 1.1 catalogue font that covers them (add_font.mjs).');
}

// ---------- report ----------
console.log(`fonts · ${path.basename(dir)} · ${times.length} moments checked`);
for (const n of notes) console.log('  ' + n);
for (const [fam, u] of [...used].sort((a, b) => b[1].glyphs - a[1].glyphs)) {
  console.log(`  ${u.custom ? '✓ installed OFL' : '✖ SYSTEM       '} ${fam}  (${u.glyphs} glyphs)`);
}
if (fails.length) {
  console.log(`\n✖ ${fails.length} font problem(s):`);
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('\n✓ every glyph on screen is drawn with an installed SIL OFL 1.1 font (catalogue or pinned Google Fonts ofl/); every font has its OFL licence file');
