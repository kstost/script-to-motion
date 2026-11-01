#!/usr/bin/env node
/**
 * snapshot.mjs — look at the real page: screenshots from headless Chromium at chosen times.
 *
 *   node snapshot.mjs <projectDir> [what] [options]
 *
 * what (default: t≈0.3, one frame 65% into every cue, the last frame)
 *   --times 3.2,7.6,…     exact times (seconds)
 *   --cues c03,c08        start / middle / end of these cues
 *   --range 7.0:8.4       a filmstrip of consecutive frames (with --step, default 0.1 s) — for motion
 *   --overview            the whole video, one thumbnail every --every seconds (default 2) — rhythm, variety
 * options
 *   --crop x,y,w,h        only this stage rectangle (stage px), rendered 2× — for details
 *   --scale 2             device scale (2 → 3840×2160 for a 16:9 stage) — sharpness
 *   --grid N              columns per contact sheet (default 2; 4 for --range; 6 for --overview)
 *   --out dir             output folder (default <project>/.snapshots); cleaned first unless --keep
 *   --compare dir         pair every frame with the same-time frame from an earlier run (before | after)
 *   --motion              measure how much the picture changes over the whole video; reports static
 *                         stretches ≥ 1.5 s (dead air) and the least dynamic cues
 *   --perf                JavaScript time per frame during playback (sequential 1/30 s steps around each shot —
 *                         what the recording sees; keep it well under ~8 ms) plus random-seek cost (informational)
 *   --captions            shoot with the player's captions on (one-line segments)
 *   --safezone            draw the project's unsafe margins on the frames (css/style.css --safe-top/-bottom/-right/--safe;
 *                         in 9:16 the areas Shorts / Reels / TikTok cover with their UI) and warn on text inside them
 *   --seekcheck           determinism: after shooting forward, seek back to every shot in reverse order and
 *                         compare the stage (DOM + every canvas's pixels) — anything that depends on what was
 *                         played before (accumulated state, Math.random, caches) shows up as a mismatch
 *
 * Every frame is labelled with its time, cue and the words being spoken at that moment (estimated by
 * character position), so you can judge sync by eye. Writes t-*.png, sheet-*.png, review.html (open it
 * in a browser — the user can review the same frames) and report.json. Also reports console errors and
 * layout problems measured by the browser (text overlapping text, text clipped by a container or the edge, and
 * glows clipped into boxes: a text-shadow cut by a SplitText mask / overflow / clip-path / mask ancestor, which
 * shows as faint rectangles behind the letters — player-api.md §4).
 *
 * Needs a browser: run setup_browser.mjs once (it records ~/.cache/motion-video-deps/browser.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error(`playwright-core is not installed. Run once:\n  node ${path.join(here, 'setup_browser.mjs')}`);
  process.exit(3);
}

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = { _: [] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  else opt._.push(argv[i]);
}
const dir = path.resolve(opt._[0] || '.');
const indexHtml = path.join(dir, 'index.html');
if (!fs.existsSync(indexHtml)) { console.error(`no index.html in ${dir}`); process.exit(2); }
const outDir = path.resolve(opt.out || path.join(dir, '.snapshots'));
fs.mkdirSync(outDir, { recursive: true });
if (!opt.keep) for (const f of fs.readdirSync(outDir)) if (/^(t-.*\.png|sheet-.*\.png|compare-.*\.png|review\.html|report\.json)$/.test(f)) fs.unlinkSync(path.join(outDir, f));

const html = fs.readFileSync(indexHtml, 'utf8');
const W = Number((html.match(/data-width="(\d+)"/) || [])[1] || 1920);
const H = Number((html.match(/data-height="(\d+)"/) || [])[1] || 1080);
const crop = typeof opt.crop === 'string' ? opt.crop.split(',').map(Number) : null;
const scale = Number(opt.scale || (crop ? 2 : 1));

// ---------- launch ----------
function browserConfig() {
  const f = path.join(os.homedir(), '.cache', 'motion-video-deps', 'browser.json');
  try {
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (c.executablePath && fs.existsSync(c.executablePath)) return c;
  } catch { /* none yet */ }
  return null;
}
async function launch() {
  const cfg = browserConfig();
  const env = { ...process.env };
  const libs = cfg ? cfg.libDirs || [] : [];
  if (libs.length) env.LD_LIBRARY_PATH = [...libs, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  try {
    return await chromium.launch({ env, ...(cfg ? { executablePath: cfg.executablePath } : {}) });
  } catch (err) {
    console.error('✖ no working browser yet. Run once (it diagnoses and fixes the environment):\n  node ' + path.join(here, 'setup_browser.mjs'));
    console.error('  ' + String(err.message || err).split('\n')[0]);
    process.exit(4);
  }
}
const browser = await launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
const page = await context.newPage();
const logs = [];
// software WebGL (SwiftShader) reports harmless "GPU stall due to ReadPixels" performance notes when screenshotting
const noise = /GL Driver Message .*(GPU stall due to ReadPixels|Performance)/;
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !noise.test(m.text())) logs.push(`console.${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`page error: ${e.message}`));

async function openPlayer(p) {
  await p.goto(pathToFileURL(indexHtml).href + (opt.captions ? '?captions' : ''));
  await p.addStyleTag({ content: '.vp-start, .vp-debug { display: none !important; } body { cursor: none !important; }' });
  await p.waitForFunction(() => document.body.classList.contains('vp-ready') || document.querySelector('.vp-error'), null, { timeout: 30000 })
    .catch(() => console.error('✖ the player did not become ready within 30 s'));
  return p.evaluate(() => (document.querySelector('.vp-error') || {}).textContent || '');
}
const bootError = await openPlayer(page);
// --safezone: tinted bands where text would sit too close to the edge (or under a platform's UI in 9:16)
if (opt.safezone && !bootError) {
  await page.evaluate(() => {
    const st = document.getElementById('stage');
    const cs = getComputedStyle(document.documentElement);
    const px = (n, d) => parseFloat(cs.getPropertyValue(n)) || d;
    const safe = px('--safe', 64), z = { top: px('--safe-top', safe), bottom: px('--safe-bottom', safe), right: px('--safe-right', safe), left: safe };
    const box = document.createElement('div');
    box.className = 'snap-safezone';
    box.dataset.zones = JSON.stringify(z);
    box.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2147483000';
    const band = (css) => { const d = document.createElement('div'); d.style.cssText = 'position:absolute;background:rgba(255,40,80,.16);outline:1px dashed rgba(255,80,110,.8);' + css; box.appendChild(d); };
    band(`left:0;right:0;top:0;height:${z.top}px`);
    band(`left:0;right:0;bottom:0;height:${z.bottom}px`);
    band(`right:0;top:${z.top}px;bottom:${z.bottom}px;width:${z.right}px`);
    band(`left:0;top:${z.top}px;bottom:${z.bottom}px;width:${z.left}px`);
    st.appendChild(box);
  });
}
if (bootError) {
  console.log('✖ player error: ' + bootError);
  for (const l of logs) console.log('  ' + l);
  await browser.close();
  process.exit(1);
}
const data = await page.evaluate(() => ({ duration: window.__video.duration, cues: window.VIDEO_DATA.cues, audioDuration: window.VIDEO_DATA.audioDuration, leadIn: window.VIDEO_DATA.leadIn }));
const cues = data.cues;

// ---------- which times ----------
const clampT = (t) => Math.max(0, Math.min(data.duration - 0.02, t));
let shots = [];
let mode = 'default';
if (typeof opt.times === 'string') {
  mode = 'times';
  shots = opt.times.split(',').map(Number).filter((n) => !Number.isNaN(n)).map((t) => ({ t: clampT(t) }));
} else if (typeof opt.cues === 'string') {
  mode = 'cues';
  for (const id of opt.cues.split(',')) {
    const c = cues.find((x) => x.id === id.trim());
    if (!c) { console.error(`unknown cue ${id}`); continue; }
    shots.push({ t: clampT(c.start + 0.15), tag: 'start' }, { t: clampT(c.start + c.duration / 2), tag: 'mid' }, { t: clampT(c.end - 0.1), tag: 'end' });
  }
} else if (typeof opt.range === 'string') {
  mode = 'range';
  const [a, b] = opt.range.split(':').map(Number);
  const step = Number(opt.step || 0.1);
  for (let t = a; t <= b + 1e-6; t += step) shots.push({ t: clampT(Math.round(t * 1000) / 1000) });
} else if (opt.overview) {
  mode = 'overview';
  const every = Number(opt.every || 2);
  for (let t = 0.3; t < data.duration; t += every) shots.push({ t: clampT(t) });
  shots.push({ t: clampT(data.duration - 0.05) });
} else {
  shots = [{ t: 0.3, tag: 'start' }];
  for (const c of cues) shots.push({ t: Math.min(c.end, c.start + Math.max(0.6, c.duration * 0.65)) });
  shots.push({ t: clampT(data.duration - 0.05), tag: 'end' });
}

// what is being said at t (by character position inside the cue)
function spokenAt(t) {
  const c = cues.find((x) => t >= x.start && t <= x.end);
  if (!c) {
    const next = cues.find((x) => x.start > t);
    return { cue: '', words: next ? `(silence — ${next.id} in ${(next.start - t).toFixed(1)}s)` : '(silence — after narration)' };
  }
  const chars = [...c.text.replace(/\s+/g, ' ')];
  const weight = chars.map((ch) => (/[\s.,!?·…"'“”‘’()[\]-]/.test(ch) ? 0 : 1));
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  const target = ((t - c.start) / c.duration) * total;
  let acc = 0;
  let i = 0;
  for (; i < chars.length - 1; i++) { acc += weight[i]; if (acc >= target) break; }
  const a = Math.max(0, i - 9);
  const b = Math.min(chars.length, i + 9);
  return { cue: c.id, words: `${a > 0 ? '…' : ''}${chars.slice(a, i).join('')}▸${chars.slice(i, b).join('')}${b < chars.length ? '…' : ''}` };
}

// ---------- layout probe (runs in the page) ----------
// Works on what is actually visible: each text box is intersected with its clipping ancestors, so text
// hidden on purpose (SplitText masks before a reveal, a digit strip in a window) is ignored.
function probe() {
  const stage = document.getElementById('stage');
  const sr = stage.getBoundingClientRect();
  const R = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const cut = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  const cls = (n) => (typeof n.className === 'string' ? n.className : (n.className && n.className.baseVal) || '');
  const eff = (el) => {
    let o = 1;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
      o *= parseFloat(cs.opacity);
    }
    return o;
  };
  const warn = [];
  const boxes = [];
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    if (el.closest('.vp-measure') || el.closest('.snap-safezone') || (el.closest('.vp-captions') && !el.closest('.vp-on'))) continue; // shown captions count
    // decorative copies (TypeFX shards/bands/extrusion layers/ghosts, FXKit glints) stand in for real text on purpose
    if (el.closest('[data-fx-copy]')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || eff(el) < 0.5) continue;
    const raw = R(el.getBoundingClientRect());
    if (area(raw) < 4) continue;
    let vis = raw;
    let clipper = null;
    for (let n = el.parentElement; n && n !== stage; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (!/(hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) continue;
      const before = area(vis);
      vis = cut(vis, R(n.getBoundingClientRect()));
      if (!clipper && area(vis) < before - 1) clipper = n;
    }
    const shown = area(vis) / area(raw);
    if (shown < 0.05) continue; // hidden on purpose
    const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 28);
    // a TypeFX unit that an effect is moving (scatter, swirl, drop…) leaves its box on purpose
    const moving = !!el.closest('.tx-i[style*="transform"]');
    // masks (SplitText) and rolling-digit windows (odometers: .od / .fxkit-od / .odo…) clip on purpose
    if (shown < 0.97 && clipper && !/mask|(^|[\s-])odo?(\s|$|-)|digit|roll/i.test(cls(clipper))) warn.push(`text clipped by its container (${Math.round(shown * 100)}% visible): "${text}"`);
    const onScreen = area(cut(vis, R(sr))) / area(vis);
    if (onScreen === 0) continue;
    if (onScreen < 0.98 && onScreen > 0.3 && !moving) warn.push(`text cut by screen edge (${Math.round(onScreen * 100)}% visible): "${text}"`);
    boxes.push({ el, r: cut(vis, R(sr)), text, tx: el.closest('[data-tx]') });
    const zoneBox = document.querySelector('.snap-safezone');
    if (zoneBox && !moving) {
      const z = JSON.parse(zoneBox.dataset.zones), k = sr.width / (stage.offsetWidth || sr.width), v = cut(vis, R(sr));
      const hit = [v.top < sr.top + z.top * k && 'top', v.bottom > sr.bottom - z.bottom * k && 'bottom', v.right > sr.right - z.right * k && 'right', v.left < sr.left + z.left * k && 'left'].filter(Boolean);
      if (hit.length && area(v) > 4) warn.push(`text in the unsafe ${hit.join('/')} margin${hit.length > 1 ? 's' : ''} (--safe-*; in 9:16 covered by Shorts/Reels/TikTok UI): "${text}"`);
    }
  }
  // glows clipped into boxes: a light text-shadow on text inside a clipping ancestor (SplitText mask, digit
  // columns, overflow hidden, clip-path, mask-image) is cut at that box -> faint rectangles behind the letters
  const parseShadows = (v) => {
    if (!v || v === 'none') return [];
    return v.split(/,(?![^(]*\))/).map((sh) => {
      const c = (sh.match(/rgba?\(([^)]+)\)/) || [])[1];
      const [r, g, b, a = 1] = c ? c.split(',').map(Number) : [0, 0, 0, 1];
      const px = (sh.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) || []).map(parseFloat);
      const [x = 0, y = 0, blur = 0] = px;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return { reach: Math.max(Math.abs(x), Math.abs(y)) + blur, glow: a >= 0.15 && lum >= 0.2 };
    }).filter((x) => x.glow && x.reach > 2);
  };
  const clipRect = (n, cs) => {
    const box = R(n.getBoundingClientRect());
    if (/(hidden|clip)/.test(cs.overflow + cs.overflowX + cs.overflowY)) return box;
    if ((cs.maskImage && cs.maskImage !== 'none') || (cs.webkitMaskImage && cs.webkitMaskImage !== 'none')) return box;
    const cp = cs.clipPath;
    if (!cp || cp === 'none') return null;
    const w = box.right - box.left, h = box.bottom - box.top;
    const m = cp.match(/^inset\(([^)]*)\)/);
    if (m) {
      const v = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/).map((x, i) => (x.endsWith('%') ? parseFloat(x) / 100 * (i % 2 ? w : h) : parseFloat(x) || 0));
      const [t, rr = t, bb = t, l = rr] = v;
      return { left: box.left + l, top: box.top + t, right: box.right - rr, bottom: box.bottom - bb };
    }
    const c = cp.match(/^circle\(\s*([\d.]+)(px|%)/);
    if (c && parseFloat(c[1]) * (c[2] === '%' ? Math.hypot(w, h) / 100 : 1) > Math.hypot(sr.width, sr.height)) return null;
    return box;
  };
  const glowWarned = new Set();
  for (const b of boxes) {
    const cs = getComputedStyle(b.el);
    const sh = parseShadows(cs.textShadow);
    if (!sh.length) continue;
    const reach = Math.max(...sh.map((x) => x.reach));
    const tr = R(b.el.getBoundingClientRect());
    const need = { left: tr.left - reach, top: tr.top - reach, right: tr.right + reach, bottom: tr.bottom + reach };
    for (let n = b.el; n && n !== stage; n = n.parentElement) {   // the element itself clips its own text too
      const cr = clipRect(n, getComputedStyle(n));
      if (!cr) continue;
      if (need.left < cr.left - 1 || need.top < cr.top - 1 || need.right > cr.right + 1 || need.bottom > cr.bottom + 1) {
        let src = b.el;   // where the shadow is declared (it is inherited)
        while (src.parentElement && src.parentElement !== stage && getComputedStyle(src.parentElement).textShadow === cs.textShadow) src = src.parentElement;
        let label = src.textContent.trim().replace(/\s+/g, ' ');
        if (/0123456789/.test(label)) label = `rolling digits ${src.tagName.toLowerCase()}${cls(src) ? '.' + cls(src).trim().split(/\s+/).join('.') : ''}`;
        label = label.slice(0, 40);
        if (!glowWarned.has(src)) {
          glowWarned.add(src);
          warn.push(`glow clipped into a box: text-shadow on "${label}" is cut by ${n.tagName.toLowerCase()}${cls(n) ? '.' + cls(n).trim().split(/\s+/)[0] : ''} (mask/overflow/clip) — faint rectangles behind the letters; use filter: drop-shadow() on an element outside the clip (player-api.md §4)`);
        }
        break;
      }
    }
  }
  const blocks = boxes.filter((b) => !boxes.some((o) => o !== b && o.el.contains(b.el)));
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      if (a.el.parentElement === b.el.parentElement && a.el.parentElement.children.length > 3) continue; // split chars/words of one line
      if (a.tx && a.tx === b.tx) continue;   // units of one TypeFX group crossing each other (jelly, wave, swirl)
      const small = Math.min(area(a.r), area(b.r));
      if (area(cut(a.r, b.r)) > small * 0.15) warn.push(`text overlaps text: "${a.text}" × "${b.text}"`);
    }
  }
  return [...new Set(warn)];
}

// the visible state of the stage: for every element that can be seen (on stage, effective opacity > 0, not hidden),
// the computed values that change the picture (GSAP's lazy inline styles that compute to the same value don't
// count), plus a hash of every visible canvas's pixels
const stageState = (p, t) => p.evaluate((tt) => {
  // re-render this frame inside the same task, so WebGL canvases still hold their drawing buffer when read
  window.__video.seek(tt);
  const st = document.getElementById('stage');
  const SR = st.getBoundingClientRect();
  const h = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(16); };
  const PROPS = ['transform', 'translate', 'rotate', 'scale', 'opacity', 'clip-path', 'filter', 'color', 'background-color', 'width', 'height',
    'left', 'top', 'font-weight', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'd', 'letter-spacing'];
  // values that draw the same picture compare equal (GSAP's lazy inline styles, identity transforms)
  const IDENT = { transform: /^matrix\(1, 0, 0, 1, 0, 0\)$/, translate: /^0(px)?( 0(px)?)?$/, rotate: /^0(deg)?$/, scale: /^1( 1)?$/ };
  const norm = (k, v) => {
    let s = String(v).replace(/-?\d*\.?\d+(e[-+]?\d+)?/gi, (n) => { const x = +(+n).toFixed(2); return String(Object.is(x, -0) ? 0 : x); });
    if (IDENT[k] && IDENT[k].test(s)) s = 'none';
    return s;
  };
  const onStage = (r) => r.right > SR.left && r.left < SR.right && r.bottom > SR.top && r.top < SR.bottom && (r.width > 0 || r.height > 0);
  const rows = [], canvases = [], gl = [];
  const walk = (el, op, path) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const o = op * parseFloat(cs.opacity || 1);
    if (o < 0.002) return;
    const r = el.getBoundingClientRect();
    if (onStage(r)) {               // off-screen elements can differ without changing the picture
      let own = '';
      for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) own += n.textContent;
      rows.push(path + '|' + PROPS.map((k) => norm(k, cs.getPropertyValue(k))).join(';') + (own ? '|' + own : ''));
      if (el.tagName === 'CANVAS') {
        // 2D canvases are read directly; WebGL ones (getContext('2d') → null) render asynchronously, so they are
        // compared from a screenshot of their box (taken in Node after the frame is presented)
        let c2 = null;
        try { c2 = el.getContext('2d'); } catch (e) { c2 = null; }
        if (c2) { try { canvases.push(path + ':' + h(el.toDataURL())); } catch (e) { canvases.push(path + ':unreadable'); } }
        else gl.push({ path, x: Math.max(r.left, SR.left), y: Math.max(r.top, SR.top), w: Math.min(r.right, SR.right) - Math.max(r.left, SR.left), h: Math.min(r.bottom, SR.bottom) - Math.max(r.top, SR.top) });
      }
    }
    let i = 0;
    for (const c of el.children) walk(c, o, path + '>' + c.tagName.toLowerCase() + (c.classList && c.classList.length ? '.' + c.classList[0] : '') + ':' + i++);
  };
  for (const c of st.children) walk(c, 1, c.tagName.toLowerCase() + (c.id ? '#' + c.id : ''));
  return { rows, domHash: h(rows.join('\n')), canvases, gl };
}, t);
async function captureState(p, t) {
  const st = await stageState(p, t);
  if (st.gl.length) {
    await settle(p);
    for (const g of st.gl) {
      if (g.w < 1 || g.h < 1) continue;
      const png = await p.screenshot({ clip: { x: g.x, y: g.y, width: g.w, height: g.h } });
      st.canvases.push(g.path + ':' + crypto.createHash('sha1').update(png).digest('hex').slice(0, 16));
    }
  }
  delete st.gl;
  return st;
}
// fonts, footage stills (js/media.js decodes the frame each clip shows at t) and two frames for layout
const settle = (p) => p.evaluate(() => document.fonts.ready
  .then(() => (window.__media && window.__media.settle ? window.__media.settle() : null))
  .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
const seekTimed = (p, t) => p.evaluate((tt) => { const a = performance.now(); window.__video.seek(tt); return performance.now() - a; }, t);
const fname = (t) => `t-${t.toFixed(2).padStart(6, '0')}.png`;
// playback-like cost: from 0.5 s before t, step forward one 30 fps frame at a time (what a recording does)
const playTimed = (p, t) => p.evaluate((tt) => {
  const out = [];
  window.__video.seek(Math.max(0, tt - 0.5));
  for (let k = 1; k <= 15; k++) { const a = performance.now(); window.__video.seek(Math.max(0, tt - 0.5) + k / 30); out.push(performance.now() - a); }
  return out;
}, t);

// ---------- shoot ----------
const frames = [];
const perf = [];
const play = [];
for (const s of shots) {
  if (opt.perf) for (const ms of await playTimed(page, s.t)) play.push({ t: s.t, ms });
  perf.push({ t: s.t, ms: await seekTimed(page, s.t) });
  await settle(page);
  if (opt.seekcheck) s.state = await captureState(page, s.t);
  const file = path.join(outDir, fname(s.t));
  if (crop) await page.screenshot({ path: file, clip: { x: crop[0], y: crop[1], width: crop[2], height: crop[3] } });
  else await page.locator('#stage').screenshot({ path: file });
  const said = spokenAt(s.t);
  frames.push({ ...s, file: path.basename(file), cue: said.cue, words: said.words, warnings: await page.evaluate(probe) });
}

// ---------- seek determinism (--seekcheck) ----------
let seekcheck = null;
if (opt.seekcheck) {
  seekcheck = [];
  for (const s of [...shots].reverse()) {
    await page.evaluate((tt) => window.__video.seek(tt), s.t);
    await settle(page);
    const b = await captureState(page, s.t);
    const a = s.state;
    if (!a) continue;
    const diffs = [];
    if (a.domHash !== b.domHash) {
      const A = new Map(a.rows.map((r) => [r.split('|')[0], r])), B = new Map(b.rows.map((r) => [r.split('|')[0], r]));
      const keys = [...new Set([...A.keys(), ...B.keys()])].filter((k) => A.get(k) !== B.get(k));
      for (const k of keys.slice(0, 3)) {
        const ra = A.get(k), rb = B.get(k);
        if (!ra || !rb) { diffs.push(`${k.split('>').slice(-3).join('>')} ${ra ? 'visible only on the first pass' : 'visible only after re-seeking'}`); continue; }
        const pa = ra.split('|')[1].split(';'), pb = rb.split('|')[1].split(';');
        const what = pa.map((v, j) => (v !== pb[j] ? `${['transform', 'translate', 'rotate', 'scale', 'opacity', 'clip-path', 'filter', 'color', 'background-color', 'width', 'height', 'left', 'top', 'font-weight', 'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'd', 'letter-spacing'][j]}: ${v.slice(0, 50)} → ${pb[j].slice(0, 50)}` : null)).filter(Boolean);
        if (ra.split('|')[2] !== rb.split('|')[2]) what.push(`text: "${(ra.split('|')[2] || '').slice(0, 30)}" → "${(rb.split('|')[2] || '').slice(0, 30)}"`);
        diffs.push(`${k.split('>').slice(-3).join('>')}: ${what.join(' · ')}`);
      }
      if (keys.length > 3) diffs.push(`… ${keys.length - 3} more element(s)`);
    }
    const bc = new Set(b.canvases);
    for (const c of a.canvases) if (!bc.has(c)) diffs.push(`canvas ${c.slice(0, c.lastIndexOf(':')).split('>').slice(-2).join('>')} pixels differ`);
    if (diffs.length) seekcheck.push({ t: s.t, diffs });
    delete s.state;
  }
}

// ---------- motion analysis ----------
let motion = null;
if (opt.motion) {
  const mw = 480;
  const mh = Math.round((mw * H) / W);
  const mctx = await browser.newContext({ viewport: { width: mw, height: mh } });
  const mp = await mctx.newPage();
  await openPlayer(mp);
  const step = 0.25;
  const imgs = [];
  for (let t = 0; t <= data.duration; t += step) {
    await mp.evaluate((tt) => window.__video.seek(tt), t);
    await settle(mp);
    imgs.push({ t, b64: (await mp.screenshot({ type: 'jpeg', quality: 70 })).toString('base64') });
  }
  const calc = await mctx.newPage();
  const diffs = await calc.evaluate(async ({ list, w, h }) => {
    const load = (b64) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = 'data:image/jpeg;base64,' + b64; });
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    let prev = null;
    const out = [];
    for (const b64 of list) {
      cx.drawImage(await load(b64), 0, 0, w, h);
      const px = cx.getImageData(0, 0, w, h).data;
      if (prev) {
        let changed = 0;
        for (let i = 0; i < px.length; i += 4) {
          if (Math.abs(px[i] - prev[i]) + Math.abs(px[i + 1] - prev[i + 1]) + Math.abs(px[i + 2] - prev[i + 2]) > 36) changed++;
        }
        out.push(changed / (w * h));
      }
      prev = px;
    }
    return out;
  }, { list: imgs.map((i) => i.b64), w: mw, h: mh });
  await mctx.close();
  const STILL = 0.003; // < 0.3 % of pixels changed between samples ≈ nothing is moving
  const still = [];
  let runStart = null;
  diffs.forEach((dv, i) => {
    const t = imgs[i + 1].t;
    if (dv < STILL) { if (runStart === null) runStart = imgs[i].t; }
    else if (runStart !== null) { if (t - runStart >= 1.5) still.push([runStart, imgs[i].t]); runStart = null; }
  });
  if (runStart !== null && imgs[imgs.length - 1].t - runStart >= 1.5) still.push([runStart, imgs[imgs.length - 1].t]);
  const perCue = cues.map((c) => {
    const vals = diffs.filter((_, i) => imgs[i + 1].t > c.start && imgs[i + 1].t <= c.end);
    return { id: c.id, text: c.text, activity: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
  });
  motion = {
    step,
    still: still.map(([a, b]) => ({ from: a, to: b, seconds: +(b - a).toFixed(2), note: a >= data.audioDuration ? 'final hold (ok)' : '' })),
    leastActive: [...perCue].sort((a, b) => a.activity - b.activity).slice(0, 3),
  };
}

// ---------- contact sheets ----------
// Labels need a Hangul-capable font: headless Linux machines often have none installed, which turns
// Korean captions into boxes. Embed the project's (or the skill's) Pretendard.
const fontFile = [path.join(dir, 'fonts', 'PretendardVariable.woff2'), path.join(here, '..', 'assets', 'template', 'fonts', 'PretendardVariable.woff2')].find((f) => fs.existsSync(f));
const fontFace = fontFile ? `@font-face{font-family:LabelFont;src:url(data:font/woff2;base64,${fs.readFileSync(fontFile).toString('base64')}) format('woff2');font-weight:100 900}` : '';
const cols = Number(opt.grid || (mode === 'overview' ? 6 : mode === 'range' ? 4 : 2));
const cellW = Math.floor(1920 / cols);
const cellH = Math.round((cellW * (crop ? crop[3] : H)) / (crop ? crop[2] : W));
const perSheet = cols * (cols <= 2 ? 2 : cols <= 4 ? 3 : 5);
async function sheet(cells, name) {
  const p = await context.newPage();
  const rows = Math.ceil(cells.length / cols);
  const fs2 = Math.max(12, Math.round(cellW / 48));
  await p.setViewportSize({ width: cellW * cols, height: cellH * rows });
  await p.setContent(`<style>${fontFace}body{margin:0;display:grid;grid-template-columns:repeat(${cols},${cellW}px);background:#111}
    figure{margin:0;position:relative;width:${cellW}px;height:${cellH}px;overflow:hidden}img{width:100%;height:100%;display:block}
    figcaption{position:absolute;left:0;top:0;max-width:100%;padding:3px 8px;background:rgba(0,0,0,.72);color:#fff;font:600 ${fs2}px/1.35 LabelFont,sans-serif}
    figcaption small{display:block;font-weight:500;opacity:.9}figure.warn{outline:4px solid #f5a623;outline-offset:-4px}</style>` +
    cells.map((c) => `<figure class="${c.warn ? 'warn' : ''}"><img src="data:image/png;base64,${fs.readFileSync(c.path).toString('base64')}">` +
      `<figcaption>${c.title}${c.sub ? `<small>${c.sub.replace(/</g, '&lt;')}</small>` : ''}</figcaption></figure>`).join(''));
  const out = path.join(outDir, name);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: out, fullPage: true });
  await p.close();
  return out;
}
const title = (f) => `t=${f.t.toFixed(2)}${f.cue ? ` · ${f.cue}` : ''}${f.tag ? ` · ${f.tag}` : ''}`;
const sheets = [];
for (let i = 0; i < frames.length; i += perSheet) {
  const cells = frames.slice(i, i + perSheet).map((f) => ({ path: path.join(outDir, f.file), title: title(f), sub: cols <= 4 ? f.words : '', warn: f.warnings.length }));
  sheets.push(await sheet(cells, `sheet-${sheets.length + 1}.png`));
}
const compares = [];
if (typeof opt.compare === 'string') {
  const other = path.resolve(opt.compare);
  const pairs = frames.filter((f) => fs.existsSync(path.join(other, f.file)));
  const saveCols = cols;
  for (let i = 0; i < pairs.length; i += 2) {
    const cells = [];
    for (const f of pairs.slice(i, i + 2)) {
      cells.push({ path: path.join(other, f.file), title: `BEFORE ${title(f)}` }, { path: path.join(outDir, f.file), title: `AFTER ${title(f)}`, sub: f.words });
    }
    if (saveCols !== 2) console.warn('(compare sheets use 2 columns)');
    compares.push(await sheet(cells, `compare-${compares.length + 1}.png`));
  }
}
await browser.close();

// ---------- review.html + report.json ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const uniqLogs = [...new Set(logs)];
const perfSorted = [...perf].sort((a, b) => b.ms - a.ms);
const perfSummary = perf.length ? { avg: +(perf.reduce((a, b) => a + b.ms, 0) / perf.length).toFixed(2), max: +perfSorted[0].ms.toFixed(2), worst: perfSorted.slice(0, 3) } : null;
const playSorted = [...play].sort((a, b) => a.ms - b.ms);
const pct = (q) => (playSorted.length ? playSorted[Math.min(playSorted.length - 1, Math.floor(q * playSorted.length))] : null);
const playSummary = play.length ? { avg: +(play.reduce((a, b) => a + b.ms, 0) / play.length).toFixed(2), p95: +pct(0.95).ms.toFixed(2), max: +playSorted[playSorted.length - 1].ms.toFixed(2), worstAt: playSorted[playSorted.length - 1].t } : null;
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ project: dir, mode, size: [W * scale, H * scale], crop, frames, console: uniqLogs, motion, perf: opt.perf ? { playback: playSummary, seek: perfSummary } : undefined, seekcheck: seekcheck || undefined }, null, 2));
fs.writeFileSync(path.join(outDir, 'review.html'), `<!doctype html><meta charset="utf-8"><title>review · ${esc(path.basename(dir))}</title>
<style>${fs.existsSync(path.join(dir, 'fonts', 'PretendardVariable.woff2')) ? `@font-face{font-family:P;src:url(${path.relative(outDir, path.join(dir, 'fonts', 'PretendardVariable.woff2'))})}` : ''}body{margin:0;background:#15161a;color:#e8e8ea;font:15px/1.5 P,system-ui,sans-serif}header{padding:16px 24px;border-bottom:1px solid #2a2c33}
h1{font-size:18px;margin:0 0 6px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:18px;padding:24px}
figure{margin:0;background:#1e2026;border-radius:8px;overflow:hidden}img{width:100%;display:block}figcaption{padding:10px 12px}
.t{font-weight:700}.w{color:#9aa0ab}.warn{color:#f5a623;margin:6px 0 0;padding-left:18px}.err{color:#ff7a7a}</style>
<header><h1>${esc(path.basename(dir))} — ${frames.length} frames (${mode})</h1>
${uniqLogs.length ? `<div class="err">console: ${uniqLogs.map(esc).join('<br>')}</div>` : '<div>console: clean</div>'}
${motion ? `<div>static stretches ≥1.5 s: ${motion.still.length ? motion.still.map((s) => `${s.from.toFixed(1)}–${s.to.toFixed(1)}s ${s.note}`).join(', ') : 'none'} · least active cues: ${motion.leastActive.map((c) => c.id).join(', ')}</div>` : ''}
</header><div class="grid">${frames.map((f) => `<figure><img src="${f.file}" loading="lazy"><figcaption><div class="t">${esc(title(f))}</div>
<div class="w">🎙 ${esc(f.words)}</div>${f.warnings.length ? `<ul class="warn">${f.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</figcaption></figure>`).join('')}</div>`);

// ---------- console report ----------
const rel = (p) => path.relative(process.cwd(), p) || '.';
console.log(`✓ ${frames.length} frames (${mode}) at ${crop ? `${crop[2] * scale}×${crop[3] * scale} crop` : `${W * scale}×${H * scale}`} → ${rel(outDir)}`);
console.log(`  look at: ${[...sheets, ...compares].map(rel).join(', ')}`);
console.log(`  review page for the user: ${rel(path.join(outDir, 'review.html'))}`);
if (uniqLogs.length) {
  console.log(`\n✖ console (${uniqLogs.length}):`);
  for (const l of uniqLogs.slice(0, 20)) console.log('  ' + l.slice(0, 300));
}
const warned = frames.filter((f) => f.warnings.length);
if (warned.length) {
  console.log('\n⚠ layout warnings (check them on the frames — some are intentional, e.g. mid-animation or a panel leaving):');
  for (const f of warned) {
    console.log(`  ${title(f)}`);
    for (const w of f.warnings.slice(0, 6)) console.log('    - ' + w);
  }
} else console.log('✓ no text overlaps or clipped text detected');
if (motion) {
  console.log(`\n~ motion (sampled every ${motion.step}s):`);
  if (motion.still.length) for (const s of motion.still) console.log(`  static ${s.from.toFixed(2)}–${s.to.toFixed(2)}s (${s.seconds}s) ${s.note}`);
  else console.log('  no static stretch ≥ 1.5 s');
  console.log('  least active cues: ' + motion.leastActive.map((c) => `${c.id} (${(c.activity * 100).toFixed(2)}% px/step) "${c.text.slice(0, 24)}…"`).join(' · '));
}
if (seekcheck) {
  if (!seekcheck.length) console.log(`\n✓ seekcheck: all ${frames.length} frames identical when reached again in reverse order (deterministic)`);
  else {
    console.log(`\n✖ seekcheck: ${seekcheck.length} of ${frames.length} frames differ when reached again — something depends on playback history (accumulated state, Math.random/Date, a cache that skips a write, a callback):`);
    for (const m of seekcheck.slice(0, 8)) { console.log(`  t=${m.t.toFixed(2)}`); for (const d of m.diffs.slice(0, 3)) console.log('    - ' + d); }
    process.exitCode = 1;
  }
}
if (opt.perf && playSummary) {
  console.log(`\n~ JS per frame during playback (sequential 1/30 s steps, GSAP + onFrame): avg ${playSummary.avg} ms, p95 ${playSummary.p95} ms, max ${playSummary.max} ms near t=${playSummary.worstAt.toFixed(2)}${playSummary.p95 > 8 ? '  ⚠ heavy — may drop frames on slower machines' : ''}`);
  console.log(`  random seek (scrubbing / ?t= / snapshots — not what the recording sees): avg ${perfSummary.avg} ms, max ${perfSummary.max} ms`);
}
