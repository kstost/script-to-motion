#!/usr/bin/env node
/**
 * check.mjs — static checks for a script-to-motion project (no browser needed).
 *
 *   node check.mjs <projectDir>
 *
 * Catches the mistakes that are invisible without watching the page: syntax errors, cue ids or
 * #ids that don't exist, unused cues, stale timings, and code that breaks seek/determinism.
 * Exit code 1 when there are errors (warnings don't fail).
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { auditFonts, stackProblems, genericOnlyStacks } from './lib/fonts.mjs';
import { auditGlyphs } from './lib/glyphs.mjs';
import { auditVendor } from './lib/vendorfetch.mjs';

const dir = path.resolve(process.argv[2] || '.');
let data;
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(dir, p));

// ---------- files ----------
const required = [
  'index.html', 'script.json', 'css/player.css', 'css/style.css', 'js/player.js', 'js/scenes.js',
  'fonts/PretendardVariable.woff2',
];
for (const f of required) if (!exists(f)) err(`missing ${f}`);
// third-party runtime (GSAP): present and exactly as published — licence notices intact (assets/vendor/catalog.json)
for (const e of auditVendor(dir)) err(e);
if (!exists('js/cues.js')) err('missing js/cues.js — run scripts/tts.mjs');
if (errors.length) finish();

// ---------- cues ----------
try {
  const ctx = { window: {} };
  vm.runInNewContext(read('js/cues.js'), ctx, { filename: 'cues.js' });
  data = ctx.window.VIDEO_DATA;
} catch (e) {
  err(`js/cues.js does not evaluate: ${e.message}`);
  finish();
}
if (!data || !Array.isArray(data.cues) || !data.cues.length) {
  err('js/cues.js has no cues');
  finish();
}
const cueIds = new Set(data.cues.map((c) => c.id));
let prevEnd = 0;
for (const c of data.cues) {
  if (!(c.duration > 0)) err(`cue ${c.id}: duration ${c.duration}`);
  if (c.start < prevEnd - 1e-6) err(`cue ${c.id} starts before the previous cue ends`);
  prevEnd = c.end;
}
if (!exists(data.audio)) err(`narration file ${data.audio} is missing`);
if (data.placeholder) warn('narration is PLACEHOLDER (silent, estimated timing) — replace it before delivering: once the user has approved the lines, run tts.mjs --approved (key and voice from the skill\'s .env), or make it a video without narration ("narration": false in script.json)');

try {
  const script = JSON.parse(read('script.json'));
  const a = JSON.stringify((script.cues || []).map((c) => [c.id, c.say, c.gapAfter ?? null, c.speed ?? null, c.captions || null]));
  const b = JSON.stringify(data.cues.map((c, i) => [c.id, c.say, (script.cues[i] || {}).gapAfter ?? null, (script.cues[i] || {}).speed ?? null, c.captions || null]));
  if (a !== b) warn('script.json changed since js/cues.js was generated — re-run tts.mjs');
  if ((script.narration === false) !== (data.narration === false)) warn(`script.json says narration ${script.narration === false ? 'off' : 'on'} but js/cues.js was made ${data.narration === false ? 'without' : 'with'} it — re-run tts.mjs`);
} catch (e) {
  err(`script.json: ${e.message}`);
}

// ---------- scenes.js ----------
const scenesSrc = read('js/scenes.js');
for (const f of ['js/player.js', 'js/scenes.js']) {
  try {
    new vm.Script(read(f), { filename: f });
  } catch (e) {
    err(`${f}: syntax error — ${e.message}`);
  }
}

// long videos: one builder per chapter in js/seg/*.js (references/long-form.md) — checked like scenes.js
const segFiles = fs.existsSync(path.join(dir, 'js', 'seg')) ? fs.readdirSync(path.join(dir, 'js', 'seg')).filter((f) => f.endsWith('.js')).map((f) => `js/seg/${f}`) : [];
for (const f of segFiles) {
  try { new vm.Script(read(f), { filename: f }); } catch (e) { err(`${f}: syntax error — ${e.message}`); }
}
// comments stripped (roughly) so commented-out examples don't trigger checks
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const code = [scenesSrc, ...segFiles.map(read)].map(stripComments).join('\n');
const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
const css = read('css/style.css');

if (!/Video\.define\s*\(/.test(stripComments(scenesSrc))) err('js/scenes.js never calls Video.define(...)');

// cue ids referenced in cue('..') calls and label positions ('c03', 'c03+=0.2', 'c03_end-=0.4')
for (const m of code.matchAll(/cue\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
  if (!cueIds.has(m[1])) err(`scenes.js: cue('${m[1]}') — no such cue`);
}
for (const m of code.matchAll(/['"`]([A-Za-z][A-Za-z0-9]*?)(_end)?([+-]=[\d.]+)['"`]/g)) {
  if (!cueIds.has(m[1])) err(`scenes.js: position '${m[0].slice(1, -1)}' refers to unknown label ${m[1]} (GSAP would silently append it at the end)`);
}
const referenced = (id) => new RegExp(`['"\`]${id}(_end)?([+-]=|['"\`])|cue\\(\\s*['"\`]${id}['"\`]`).test(code);
const unused = data.cues.filter((c) => !referenced(c.id)).map((c) => c.id);
if (unused.length && !/\bcues\s*(\.\s*(forEach|map|filter|find|slice|at)\b|\[)|\bfor\s*\(\s*const\s+\w+\s+of\s+cues\b|=\s*cues\b/.test(code)) {
  warn(`cues never referenced in scenes.js: ${unused.join(', ')} — every narration beat should drive something on screen`);
}

// determinism / seekability
const rules = [
  [/Math\.random\s*\(/, 'error', 'Math.random() — use rand(seed) so every playback and seek looks identical'],
  [/\bDate\.now\s*\(|new\s+Date\s*\(/, 'error', 'Date — visuals must depend only on the playhead t'],
  [/performance\.now\s*\(/, 'error', 'performance.now() — use the t passed to onFrame'],
  [/\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/, 'error', 'timers/rAF — the player drives every frame; use tl or onFrame(t)'],
  [/\bgsap\s*\.\s*(to|from|fromTo)\s*\(/, 'error', 'standalone gsap.to/from/fromTo plays on wall-clock time — put tweens on tl (gsap.set is fine)'],
  [/repeat\s*:\s*-1/, 'error', 'repeat: -1 inside the master timeline makes its duration infinite — use a finite repeat, a CSS @keyframes loop, or onFrame(t)'],
  [/\.call\s*\(|on(Complete|Start|Repeat|ReverseComplete)\s*:/, 'warn', 'timeline callbacks fire unreliably when seeking — prefer tweened properties or onFrame(t)'],
  [/\.play\s*\(\s*\)|\.restart\s*\(/, 'warn', 'play()/restart() on a tween/timeline — the player owns playback'],
  [/\.style\.display\s*=|display\s*:\s*['"]none/, 'warn', 'toggling display restarts CSS animations and breaks layout measurement — use scene() / autoAlpha'],
  [/new\s+THREE\.Clock|\.getDelta\s*\(|\.getElapsedTime\s*\(|setAnimationLoop\s*\(/, 'error', 'three.js clock/animation loop — render from onFrame(t) only'],
  [/mixer\w*\.update\s*\(/i, 'error', 'AnimationMixer.update(delta) accumulates time — use mixer.setTime(t) in onFrame'],
  [/\bscrambleText\s*:/, 'error', 'scrambleText (GSAP ScrambleTextPlugin) picks its characters with Math.random — the same t shows different letters after a seek; use FXKit kick() (references/fx-kit.md) or a scramble hashed from (char index, frame)'],
];
for (const [re, level, msg] of rules) if (re.test(code)) (level === 'error' ? err : warn)(`scenes.js: ${msg}`);

// the same determinism rules for every other script the page runs that the author (or a worker) wrote:
// illustration modules (js/art/*.js, references/art-library.md) and any extra js/*.js
{
  const own = [];
  const jsDir = path.join(dir, 'js');
  for (const f of fs.existsSync(jsDir) ? fs.readdirSync(jsDir) : []) if (f.endsWith('.js') && !['scenes.js', 'player.js', 'cues.js'].includes(f)) own.push(`js/${f}`);
  const artDir = path.join(dir, 'js', 'art');
  for (const f of fs.existsSync(artDir) ? fs.readdirSync(artDir) : []) if (f.endsWith('.js')) own.push(`js/art/${f}`);
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const f of own) {
    const src = strip(read(f));
    try { new vm.Script(src, { filename: f }); } catch (e) { err(`${f}: syntax error — ${e.message}`); continue; }
    for (const [re, level, msg] of rules.slice(0, 4).concat(rules.slice(-1))) if (re.test(src)) (level === 'error' ? err : warn)(`${f}: ${msg}`);
  }
  // late drawing: something that is still loading or drawing after a seek needs busy(fn) (or an awaited decode() at build
  // time), else a frame-by-frame render (burnmp4.py) can capture it half-drawn (player-api.md §4). media.js does it itself.
  {
    const LATE = /\bnew\s+Worker\s*\(|createElement\(\s*['"`]iframe|<iframe\b|\bcreateImageBitmap\s*\(|\bnew\s+Image\s*\(|\.src\s*=(?!=)/;
    const segDir = path.join(dir, 'js', 'seg');
    const seg = fs.existsSync(segDir) ? fs.readdirSync(segDir).filter((f) => f.endsWith('.js')).map((f) => `js/seg/${f}`) : [];
    const all = [['js/scenes.js', strip(code)], ...[...own, ...seg].filter((f) => f !== 'js/media.js').map((f) => [f, strip(read(f))])];
    const busyAnywhere = all.some(([, src]) => /\bbusy\s*\(|\.renderBusy\s*=/.test(src));   // (or a page that defines renderBusy itself)
    for (const [f, src] of all) {
      if (!LATE.test(src) || busyAnywhere || /await\s[^;\n]*\.decode\s*\(/.test(src)) continue;
      warn(`${f}: loads or draws after a seek (img.src / new Image / iframe / Worker / createImageBitmap) and nothing registers busy(fn) — a frame-by-frame render (burnmp4.py) may capture it half-drawn: await img.decode() inside define for what is set once, busy(() => !img.complete) for what changes with t (player-api.md §4)`);
    }
  }
  // cokacmotion demo code pasted without porting: its runtime, modules and fonts don't exist here (references/cokacmotion.md §4)
  const PASTED = /\bdefineDemo\s*\(|_lib\/(?:stage|type)\.js|node_modules\/|@fontsource/;
  for (const [f, src] of [['index.html', html], ['js/scenes.js', code], ...own.map((f) => [f, strip(read(f))])]) {
    if (PASTED.test(src)) err(`${f}: cokacmotion demo code pasted as is (defineDemo, _lib/stage.js, node_modules/ or @fontsource) — port the technique into project code (references/cokacmotion.md §4)`);
  }
}

// shader FX build (StageFX): one clock, no internal-time nodes, effect chain intact (references/shader-fx.md §3)
const usesFX = html.includes('vendor/three/stagefx.js');
if (usesFX && html.includes('vendor/three/stage3d.js')) err('index.html loads both three.js builds — keep one (enable_3d.mjs switches)');
if (usesFX) {
  const fxRules = [
    [/\bTSL\s*\.\s*(time|deltaTime|frameId)\b|\{[^}]*\b(time|deltaTime|frameId)\b[^}]*\}\s*=\s*[\w.]*TSL\b/, 'error', 'TSL time/deltaTime/frameId run on performance.now(), not the playhead — use fx.uTime'],
    [/\bfilm\s*\(/, 'error', 'film() noise runs on TSL time (and is not in the FX build) — use the uTime grain recipe (shader-fx.md §4)'],
    [/\bStage3D\.create\s*\(/, 'error', 'this project uses the FX build — Stage3D.create → await StageFX.create'],
    [/(?<!await\s{0,4})\bStageFX\.create\s*\(/, 'error', 'StageFX.create is async — `const fx = await StageFX.create(...)` inside an async define'],
    [/(?<!await\s{1,4}[\w$.]*)\.textTexture\s*\(/, 'error', 'fx.textTexture is async (it loads the glyphs first) — await it'],
    [/\brenderer\s*\.\s*render\s*\(/, 'warn', 'renderer.render() bypasses the effect chain — call fx.render(t) in onFrame'],
    [/\brenderer\s*\.\s*compute\s*\(/, 'warn', 'renderer.compute() directly — register with fx.addCompute(node) (runs twice per frame: WebGL2 shows compute one frame late)'],
    [/\b(afterImage|motionBlur|traa)\s*\(/, 'warn', 'class-C effect (frame history): exact in continuous playback/recording, approximate after a seek and in snapshot stills'],
  ];
  for (const [re, level, msg] of fxRules) if (re.test(code)) (level === 'error' ? err : warn)(`scenes.js: ${msg}`);
  if (!/\bfx\w*\s*\.\s*render\s*\(\s*t\b|\.render\s*\(\s*t\s*\)/.test(code)) warn('scenes.js: no fx.render(t) found — shaders must receive the playhead (fx.render(t) in onFrame sets fx.uTime)');
}

// #ids used in scenes.js must exist in index.html (or be created in scenes.js)
const htmlIds = new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]));
const madeIds = new Set([...code.matchAll(/\bid\s*=\s*['"`]([\w-]+)['"`]|\.id\s*=\s*['"`]([\w-]+)['"`]/g)].map((m) => m[1] || m[2]));
const missingIds = new Set();
for (const s of code.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
  for (const m of s[2].matchAll(/#([A-Za-z][\w-]*)/g)) {
    if (/^[0-9a-fA-F]{3,8}$/.test(m[1])) continue; // colour
    if (!htmlIds.has(m[1]) && !madeIds.has(m[1])) missingIds.add(m[1]);
  }
}
if (missingIds.size) err(`scenes.js targets #ids not found in index.html: ${[...missingIds].map((i) => '#' + i).join(', ')}`);

// every scene section should be scheduled
for (const m of html.matchAll(/<section[^>]*class=["'][^"']*\bscene\b[^"']*["'][^>]*>/g)) {
  const id = (m[0].match(/\bid=["']([^"']+)["']/) || [])[1];
  if (!id) warn('a <section class="scene"> has no id');
  else if (!new RegExp(`#${id}\\b`).test(code)) warn(`scene #${id} is never referenced in scenes.js (it would never show)`);
}

// styles
if (/(^|[;{\s])transition\s*:/m.test(css)) warn('style.css uses CSS transitions — they run on wall-clock time and ignore seeking; animate on tl instead');
if (/will-change/.test(css)) warn('style.css uses will-change — layers may stay blurry when the stage is scaled up (fullscreen/4K)');
for (const [name, src] of [['index.html', html], ['style.css', css], ['scenes.js', code]]) {
  if (/(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|@import\s+(url\()?["']?https?:/i.test(src)) {
    warn(`${name} loads something from the network — the project should play offline (vendor fonts/assets locally)`);
  }
}

// originality (SKILL.md → Originality): every image / video / audio / 3D file and every embedded data: image must be
// either generated by the skill's own pipeline or provided by the user and declared in provenance.json
{
  const MEDIA = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|ico|heic|svg|mp4|webm|mov|m4v|avi|mkv|mp3|wav|ogg|oga|m4a|aac|flac|opus|glb|gltf|fbx|obj|usdz|stl|lottie|hdr|exr)$/i;
  const SKIP_DIRS = new Set(['.git', 'node_modules', '.snapshots', '.tts-cache', 'fonts', 'vendor', 'assets3d', 'models', 'screenshots']);   // screenshots: burnmp4.py --screenshot sheets
  // + burnmp4.py's output, and the footage frames stills.mjs cuts from the declared clips' masters (media/stills for the
  // review tools, media/render-stills for burnmp4.py) — rebuilt any time, their source is the provenance of the clip
  const generated = (rel) => /^audio\/(narration\.(wav|mp3)|cues\/[^/]+\.wav)$/.test(rel) || rel === 'movie.mp4'
    || /^media\/(stills|render-stills)\/[^/]+\/\d+\.jpg$/.test(rel);
  let prov = { assets: [] };
  if (exists('provenance.json')) {
    try { prov = JSON.parse(read('provenance.json')); } catch (e) { err(`provenance.json is not valid JSON: ${e.message}`); }
  }
  const declared = new Map();
  for (const a of prov.assets || []) {
    if (!a || !a.file) { err('provenance.json: every entry needs "file"'); continue; }
    if (a.source !== 'user') err(`provenance.json: ${a.file} — only files the user provided belong here (source: "user"); everything else must be drawn in this project`);
    else if (!exists(a.file)) warn(`provenance.json lists ${a.file}, which is not in the project`);
    declared.set(path.normalize(a.file), a);
  }
  const found = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(r); continue; }
      if (MEDIA.test(e.name) && !generated(r.split(path.sep).join('/')) && !declared.has(path.normalize(r))) found.push(r);
    }
  };
  walk('');
  for (const f of found) err(`${f}: media file with no provenance — content must be made here (SVG/CSS/canvas/js/art, Blender scripts); a file the user provided goes in assets/user/ and provenance.json (source: "user")`);
  const own = ['index.html', ...fs.readdirSync(path.join(dir, 'css')).filter((f) => f.endsWith('.css')).map((f) => 'css/' + f)];
  for (const sub of ['js', 'js/art']) if (fs.existsSync(path.join(dir, sub))) own.push(...fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith('.js') && f !== 'cues.js' && f !== 'glyphs.js').map((f) => `${sub}/${f}`));
  for (const f of own) {
    if (/data:(image|video|audio)\/[\w+.-]+;base64,/i.test(read(f))) err(`${f}: embedded base64 media (data:image/video/audio) — draw it in code; a user-provided file goes in assets/user/ with a provenance.json entry`);
  }
}

// footage (references/footage.md): every clip in js/media-src.js has its playback copy; a missing master only means the
// review tools can't cut its stills
if (exists('js/media-src.js') && /js\/media\.js/.test(html)) {
  try {
    const box = { window: {} };
    vm.runInNewContext(read('js/media-src.js'), box, { filename: 'media-src.js' });
    const clips = ((box.window.MEDIA_SRC || {}).clips) || {};
    for (const [k, c] of Object.entries(clips)) {
      if (!c.file || !exists(c.file)) err(`js/media-src.js: clip ${k} — playback file ${c.file} is missing`);
      if (!(c.w > 0 && c.h > 0)) err(`js/media-src.js: clip ${k} needs w and h (the master's pixel size)`);
      if (c.master && !fs.existsSync(path.resolve(dir, c.master))) warn(`js/media-src.js: clip ${k} — master ${c.master} not found (stills.mjs can't cut its review frames)`);
    }
  } catch (e) { err(`js/media-src.js does not evaluate: ${e.message}`); }
}
// measured phrase timing (sync.mjs): stale entries make when() fall back to the estimate
if (exists('js/sync.js') && !data.placeholder && data.narration !== false) {
  try {
    const box = { window: {} };
    vm.runInNewContext(read('js/sync.js'), box, { filename: 'sync.js' });
    const S = box.window.SYNC || {};
    if (!Object.keys(S).length) warn('js/sync.js is empty — run sync.mjs so cue().when() lands on the measured words');
    else {
      const stale = data.cues.filter((c) => !S[c.id] || S[c.id].text !== c.text || Math.abs(S[c.id].d - c.duration) >= 0.01).map((c) => c.id);
      if (stale.length) warn(`js/sync.js does not match ${stale.length} cue(s) (${stale.slice(0, 6).join(', ')}${stale.length > 6 ? ' …' : ''}) — re-run sync.mjs`);
    }
  } catch (e) { err(`js/sync.js does not evaluate: ${e.message}`); }
}
// spoken register (script-writing.md §5b): Korean narration ends about 75 % in ~니다 and 25 % in ~요, with filler words
if (data.narration !== false && /^ko/.test(data.lang || 'ko')) {
  let yo = 0, nida = 0, filled = 0;
  const FILLER = /(^|[\s,.?!…])(자|그럼|근데|그런데|사실|그러니까|이제|아|한번|좀|여기서|보시면|그래서|뭐)([,\s]|$)/;
  for (const c of data.cues) {
    const text = String(c.text || '');
    if (FILLER.test(text)) filled++;
    for (const m of text.matchAll(/([가-힣]+)\s*[.?!…]+(?=["'”’)\]]*(\s|$))/g)) {
      const w = m[1];
      if (/(요|죠)$/.test(w)) yo++;
      else if (/(니다|니까)$/.test(w)) nida++;
    }
  }
  const n = yo + nida;
  if (n >= 8) {
    const share = yo / n;
    if (share < 0.15 || share > 0.35) warn(`narration endings: ~요 ${Math.round(share * 100)} % · ~니다 ${Math.round((1 - share) * 100)} % (${yo} / ${nida}) — aim for about 25 / 75 (script-writing.md §5b; keep the user's own script as given)`);
  }
  if (data.cues.length >= 12 && filled < data.cues.length / 8) warn(`only ${filled} of ${data.cues.length} lines carry a spoken filler word (자, 사실, 그러니까, 이제 …) — narration is speech, not writing (script-writing.md §5b)`);
}

// chapters (chapters.mjs) and subtitles (subs.mjs)
try {
  const script = JSON.parse(read('script.json'));
  for (const ch of script.chapters || []) if (!cueIds.has(ch.from)) err(`script.json chapters: no cue ${ch.from}`);
} catch { /* reported above */ }
if (exists('subs.json')) {
  try {
    const subs = JSON.parse(read('subs.json'));
    for (const [lang, tr] of Object.entries(subs.translations || {})) {
      const miss = data.cues.filter((c) => !tr[c.id]).map((c) => c.id);
      if (miss.length) warn(`subs.json: ${lang} has no translation for ${miss.slice(0, 6).join(', ')}${miss.length > 6 ? ' …' : ''}`);
    }
    for (const g of subs.extra || []) if (!cueIds.has(g.after)) err(`subs.json extra: no cue ${g.after}`);
  } catch (e) { err(`subs.json: ${e.message}`); }
}

// secrets: no API key in any project file (projects get shared and published) — keys live in the skill's .env
{
  const KEYS = /\b(chk_[A-Za-z0-9]{20,}|sk-fish-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{30,})/;
  const SKIP = new Set(['.git', 'node_modules', '.snapshots', '.tts-cache', 'fonts', 'vendor', 'media', 'assets']);
  const TEXT = /\.(js|mjs|json|html|css|md|txt|srt|py|sh)$/i;
  const scan = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) scan(r); continue; }
      if (e.name === '.env' || !TEXT.test(e.name)) continue;
      const st = fs.statSync(path.join(dir, r));
      if (st.size > 4e6) continue;
      if (KEYS.test(fs.readFileSync(path.join(dir, r), 'utf8'))) err(`${r}: contains what looks like an API key — remove it; keys belong only in the skill's .env (never in a project or a tracked file)`);
    }
  };
  scan('');
}

// fonts — only the skill's catalogue fonts, unmodified, with licence files (SKILL.md → Fonts)
{
  const fa = auditFonts(dir);
  for (const e of fa.errors) err(e);
  for (const w of fa.warnings) warn(w);
  const bad = stackProblems(dir, fa.families);
  // glyph outlines (TypeFX, text_to_paths.mjs): made from installed catalogue OFL fonts, in sync with glyphs.json
  const ga = auditGlyphs(dir);
  for (const e of ga.errors) err(e);
  for (const w of ga.warnings) warn(w);
  if (bad.length) err(`font names outside the installed catalogue fonts (system/remote fonts vary per machine and may not be licensed for a published video): ${bad.join(', ')} — use ${[...fa.families].map((f) => `'${f}'`).join(', ')} + a generic fallback, or install one with add_font.mjs`);
  // a stack that names no installed font (only sans-serif, monospace … or a reset to the browser default) is drawn by a system font
  const gen = genericOnlyStacks(dir);
  if (gen.length) err(`font declarations with no installed font, only a generic family — the text would be drawn by a system font: ${gen.join(' · ')} — put an installed SIL OFL 1.1 family first ('Pretendard', sans-serif)`);
  // canvas text without ctx.font is drawn in the browser's default "10px sans-serif" — a system font
  const jsFiles = ['js/scenes.js', ...(fs.existsSync(path.join(dir, 'js')) ? fs.readdirSync(path.join(dir, 'js')).filter((f) => f.endsWith('.js') && !['scenes.js', 'player.js', 'cues.js', 'glyphs.js', 'sync.js'].includes(f)).map((f) => `js/${f}`) : []),
    ...['js/seg', 'js/art'].flatMap((d) => (fs.existsSync(path.join(dir, d)) ? fs.readdirSync(path.join(dir, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`) : []))];
  for (const f of jsFiles) {
    if (!fs.existsSync(path.join(dir, f))) continue;
    // comments and string contents out (a file of code shown on screen holds "fillText" as text, not as a call)
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
    if (/\.(fillText|strokeText)\s*\(/.test(src) && !/\.font\s*=/.test(src)) warn(`${f}: draws canvas text (fillText/strokeText) but never sets ctx.font — the canvas default is "10px sans-serif", a system font: set ctx.font = "<size>px 'Pretendard', sans-serif" (an installed family first) before drawing`);
  }
}

finish();

function finish() {
  const r = path.relative(process.cwd(), dir);
  const rel = !r ? '.' : r.startsWith('..') ? dir : r;
  for (const e of errors) console.log('✖ ' + e);
  for (const w of warnings) console.log('⚠ ' + w);
  if (!errors.length && !warnings.length) console.log(`✓ ${rel}: no problems found`);
  else console.log(`\n${rel}: ${errors.length} error(s), ${warnings.length} warning(s)`);
  if (data && data.cues) {
    console.log(`  ${data.cues.length} cues · narration ${data.audioDuration}s · video ${data.duration}s`);
  }
  process.exit(errors.length ? 1 : 0);
}
