// Headless Chromium for the project tools that need the page (stills, silence, dub, errscan, thumbnail): the same browser
// and libraries setup_browser.mjs recorded for snapshot.mjs, and the page opened in review mode (?stills: footage as
// pre-extracted frames, no wall-clock playback).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function launch() {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    console.error(`playwright-core is not installed. Run once:\n  node ${path.join(here, '..', 'setup_browser.mjs')}`);
    process.exit(3);
  }
  let cfg = null;
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.cache', 'motion-video-deps', 'browser.json'), 'utf8'));
    if (c.executablePath && fs.existsSync(c.executablePath)) cfg = c;
  } catch { /* none yet */ }
  const env = { ...process.env };
  const libs = cfg ? cfg.libDirs || [] : [];
  if (libs.length) env.LD_LIBRARY_PATH = [...libs, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  try {
    return await chromium.launch({ env, ...(cfg ? { executablePath: cfg.executablePath } : {}),
      args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  } catch (err) {
    console.error('✖ no working browser yet. Run once (it diagnoses and fixes the environment):\n  node ' + path.join(here, '..', 'setup_browser.mjs'));
    console.error('  ' + String(err.message || err).split('\n')[0]);
    process.exit(4);
  }
}

/** the project's index.html in review mode; resolves when the player is ready (or throws its error) */
export async function openPage(browser, dir, { query = 'stills', errors = null } = {}) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const W = Number((html.match(/data-width="(\d+)"/) || [])[1] || 1920);
  const H = Number((html.match(/data-height="(\d+)"/) || [])[1] || 1080);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => { if (errors) errors.push('pageerror: ' + e.message); });
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    const t = m.text();
    if (/^Failed to load resource: net::/.test(t)) return;   // reported with its file by 'requestfailed' below
    if (errors) errors.push(`${m.type()}: ${t}`);
  });
  // files the page asked for and didn't get (a missing js/art/*.js, an <img>, a stylesheet). Not counted: a download the
  // page stopped itself (ERR_ABORTED — the narration), and the footage playback copies (js/media-src.js clips' `file`),
  // which js/media.js deliberately leaves unloaded in review mode. Missing footage stills mean stills.mjs hasn't cut them.
  const playback = new Set();
  try {
    const box = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'js', 'media-src.js'), 'utf8'), box);
    for (const c of Object.values(((box.window.MEDIA_SRC || {}).clips) || {})) if (c && c.file) playback.add(path.resolve(dir, c.file));
  } catch { /* no footage */ }
  const stillsTold = new Set();
  page.on('requestfailed', (r) => {
    const why = (r.failure() || {}).errorText || '';
    if (!errors || /ERR_ABORTED/.test(why)) return;
    let file = null;
    try { file = r.url().startsWith('file:') ? fileURLToPath(r.url().split(/[?#]/)[0]) : null; } catch { /* not a file */ }
    if (file && playback.has(file)) return;
    const rel = file ? path.relative(dir, file).split(path.sep).join('/') : r.url().slice(0, 160);
    const still = rel.match(/^(media\/[^/]+)\/([^/]+)\/\d{5}\.jpg$/);
    if (still) {   // one line per placement, not one per frame
      if (!stillsTold.has(still[2])) { stillsTold.add(still[2]); errors.push(`missing footage stills ${still[1]}/${still[2]}/ — run stills.mjs ${dir} (review tools show the clip empty until then)`); }
      return;
    }
    errors.push(file ? `missing file: ${rel} (${why})` : `failed to load ${rel} (${why}) — the video must play offline from its own files`);
  });
  await page.goto(pathToFileURL(path.join(dir, 'index.html')).href + (query ? '?' + query : ''));
  await page.waitForFunction(() => document.body.classList.contains('vp-ready') || document.querySelector('.vp-error'), null, { timeout: 120000 });
  const err = await page.evaluate(() => (document.querySelector('.vp-error') || {}).textContent || '');
  if (err) throw new Error('page error: ' + err);
  return page;
}

/** run a command; rejects with the tail of stderr */
export function run(cmd, args) {
  return new Promise((ok, bad) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => (c ? bad(new Error(`${cmd} exited ${c}: ${err.slice(-500)}`)) : ok()));
  });
}

export async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

/** --key value / --flag arguments; positional ones in _ */
export function parseArgs(argv = process.argv.slice(2)) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else o._.push(argv[i]);
  }
  return o;
}
