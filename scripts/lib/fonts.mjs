/**
 * fonts.mjs — the skill's font catalogue (assets/fonts/catalog.json) and the checks built on it.
 *
 * Policy: text fonts are SIL Open Font License 1.1 ONLY. A video may only use the catalogued fonts — all
 * SIL OFL 1.1 — downloaded from their official sources and copied unmodified (sha256 in the catalogue) with
 * their OFL 1.1 licence files. The skill itself ships no font files (lib/fontfetch.mjs downloads them).
 * Used by check.mjs (static), check_fonts.mjs (static + real Chromium), add_font.mjs and new_project.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isOfl11, REQUIRED_LICENSE } from './fontfetch.mjs';
import { readLock } from './gfonts.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(here, '..', '..');
export const CATALOG_PATH = path.join(SKILL_DIR, 'assets', 'fonts', 'catalog.json');
export const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|math|emoji|fangsong|inherit|initial|unset|revert|revert-layer)$/i;

export function loadCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}
export const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');

/** every .css in <dir>/css and <dir>/fonts (recursively) */
export function projectCss(dir) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory()) walk(r); else if (e.name.endsWith('.css')) out.push(r);
    }
  };
  walk('css'); walk('fonts');
  return out;
}

/**
 * every font this project may use: the skill's catalogue (pinned, recommended) + the families installed from Google
 * Fonts' ofl/ directory, recorded with their commit and sha256 in fonts/fonts.lock.json (add_font.mjs).
 * Lock entries that are not ofl/ + SIL OFL 1.1 are returned in `bad`.
 */
export function allowedFonts(dir, catalog = loadCatalog()) {
  const fonts = catalog.fonts.filter((f) => f.license === REQUIRED_LICENSE);
  const bad = [];
  let lock = { fonts: [] };
  try { lock = readLock(dir); } catch (e) { bad.push(`fonts/fonts.lock.json is not valid JSON (${e.message}) — reinstall the fonts with add_font.mjs`); }
  for (const f of lock.fonts || []) {
    if (f.source !== 'google/fonts' || !String(f.path || '').startsWith('ofl/') || f.license !== REQUIRED_LICENSE || !/^[0-9a-f]{40}$/.test(f.commit || '')) {
      bad.push(`fonts.lock.json: "${f.family}" is not an SIL OFL 1.1 family from google/fonts ofl/ at a pinned commit — remove it`);
      continue;
    }
    if (fonts.some((c) => c.family.toLowerCase() === f.family.toLowerCase())) continue;   // the catalogue entry wins
    fonts.push(Object.assign({ fromLock: true }, f));
  }
  return { fonts, bad };
}

/** @font-face rules in the project: [{ css, family, url, file }] */
export function fontFaces(dir) {
  const faces = [];
  for (const css of projectCss(dir)) {
    const text = strip(fs.readFileSync(path.join(dir, css), 'utf8'));
    for (const block of text.match(/@font-face\s*{[^}]*}/g) || []) {
      const family = ((block.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?/) || [])[1] || '').trim();
      const urls = [...block.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
      for (const url of urls.length ? urls : [null]) {
        const remote = url && /^(https?:)?\/\//.test(url);
        const file = url && !remote ? path.resolve(path.dirname(path.join(dir, css)), url.split(/[?#]/)[0]) : null;
        faces.push({ css, family, url, remote, file });
      }
    }
  }
  return faces;
}

/**
 * Audit the project's fonts against the catalogue.
 * Returns { errors, warnings, families: Set<lowercase family declared & allowed>, used: Set<catalog id> }.
 */
export function auditFonts(dir, catalog = loadCatalog()) {
  const errors = [];
  const warnings = [];
  for (const f of catalog.fonts) {
    if (f.license !== REQUIRED_LICENSE) errors.push(`catalogue: ${f.id} is licensed "${f.license}" — only ${REQUIRED_LICENSE} fonts are allowed; remove it from assets/fonts/catalog.json`);
  }
  const { fonts: ALLOWED, bad } = allowedFonts(dir, catalog);
  errors.push(...bad);
  const byFamily = new Map(ALLOWED.map((f) => [f.family.toLowerCase(), f]));
  const hashes = new Map();
  for (const f of ALLOWED) for (const file of f.files) hashes.set(file.sha256, f.id);
  const families = new Set();
  const used = new Set();
  const hashCache = new Map();
  for (const face of fontFaces(dir)) {
    const cat = byFamily.get(face.family.toLowerCase());
    if (!cat) { errors.push(`${face.css}: @font-face "${face.family}" is neither a catalogue font nor a Google Fonts OFL family in fonts/fonts.lock.json — install it with add_font.mjs (catalogue id or Google Fonts family name)`); continue; }
    families.add(face.family.toLowerCase());
    used.add(cat.id);
    if (!face.url) continue;
    if (face.remote) { errors.push(`${face.css}: "${face.family}" loads a remote font (${face.url}) — install it from the catalogue (add_font.mjs)`); continue; }
    if (!fs.existsSync(face.file)) { errors.push(`${face.css}: "${face.family}" → missing ${path.relative(dir, face.file)} (add_font.mjs ${dir} ${cat.id})`); continue; }
    if (!hashCache.has(face.file)) hashCache.set(face.file, sha256(face.file));
    const owner = hashes.get(hashCache.get(face.file));
    if (owner !== cat.id) errors.push(`${path.relative(dir, face.file)}: not the ${cat.fromLock ? 'pinned (fonts.lock.json)' : "catalogue's"} unmodified file for "${face.family}" (sha256 mismatch) — reinstall with add_font.mjs`);
  }
  for (const id of used) {
    const cat = ALLOWED.find((f) => f.id === id);
    const lic = path.join(dir, cat.licenseFile.dest);
    if (!fs.existsSync(lic)) errors.push(`${cat.licenseFile.dest}: licence file for ${cat.family} is missing (add_font.mjs ${dir} ${id})`);
    else if (!isOfl11(fs.readFileSync(lic, 'utf8'))) errors.push(`${cat.licenseFile.dest}: not the SIL Open Font License 1.1 text — only ${REQUIRED_LICENSE} fonts may be used (reinstall with add_font.mjs)`);
  }
  // no font file in the project may be anything but an unmodified catalogue / locked Google Fonts OFL file
  const known = new Set(ALLOWED.flatMap((f) => f.files.map((x) => x.sha256)));
  const skip = new Set(['.snapshots', '.tts-cache', 'node_modules', '.git', 'audio']);
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(r); continue; }
      if (!/\.(ttf|otf|woff2?|ttc|otc|eot|pfb|pfa|dfont)$/i.test(e.name)) continue;
      const h = hashCache.get(path.join(dir, r)) || sha256(path.join(dir, r));
      if (!known.has(h)) errors.push(`${r}: font file that is neither an unmodified catalogue font nor a pinned Google Fonts OFL file (fonts.lock.json) — only ${REQUIRED_LICENSE} fonts installed with add_font.mjs may be in the project; delete it`);
    }
  };
  walk('.');
  return { errors, warnings, families, used };
}

/** font names in stacks (CSS declarations, shorthand, inline styles, JS) that aren't declared catalogue families */
export function stackProblems(dir, families) {
  const bad = new Set();
  const check = (where, value) => {
    for (const raw of value.replace(/var\([^)]*\)/g, '').split(',')) {
      const name = raw.trim().replace(/^['"]|['"]$/g, '').trim();
      if (!name || GENERIC.test(name) || families.has(name.toLowerCase())) continue;
      bad.add(`${where}: "${name}"`);
    }
  };
  for (const css of projectCss(dir).filter((c) => c.startsWith('css/'))) {
    const t = strip(fs.readFileSync(path.join(dir, css), 'utf8')).replace(/@font-face\s*{[^}]*}/g, '');
    for (const [, v] of t.matchAll(/(?:font-family|--[\w-]*font[\w-]*|--mono|--serif|--display|--hand)\s*:\s*([^;{}]+)/g)) check(css, v);
    for (const [, v] of t.matchAll(/(?:^|[;{\s])font\s*:\s*[^;{}]*?\d[\d.]*(?:px|em|rem|%|pt)(?:\s*\/\s*[\d.]+\w*)?\s+([^;{}]+)/g)) check(css, v);
  }
  const html = path.join(dir, 'index.html');
  if (fs.existsSync(html)) for (const [, v] of strip(fs.readFileSync(html, 'utf8')).matchAll(/font-family\s*:\s*([^;"']+)/g)) check('index.html', v);
  const jsDir = path.join(dir, 'js');
  if (fs.existsSync(jsDir)) {
    for (const f of fs.readdirSync(jsDir).filter((n) => n.endsWith('.js') && !/^(player|cues)\.js$/.test(n))) {
      fs.readFileSync(path.join(jsDir, f), 'utf8').split('\n').forEach((line, i) => {
        const m = line.match(/(?:fontFamily|\.font)\s*[:=]\s*[`'"]([^`'"]+)[`'"]/);
        if (!m) return;
        const v = m[1].replace(/\$\{[^}]*\}/g, ' ').trim();                         // template parts (weight/size vars)
        const after = v.match(/(?:^|\s)[\d.]+(?:px|em|rem|pt|%)(?:\s*\/\s*[\d.]+\w*)?\s+(.+)$/);  // shorthand: families follow the size
        check(`js/${f}:${i + 1}`, after ? after[1] : v.replace(/^(?:italic|oblique|normal|bold|\d{3}|\s)+/i, ''));
      });
    }
  }
  return [...bad];
}

/** a CSS @font-face block for one catalogue file, relative to css/ */
export function faceCss(font, file) {
  const ext = path.extname(file.dest).slice(1).toLowerCase();
  const format = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' }[ext] || ext;
  return `@font-face {\n  font-family: '${font.family}';   /* ${font.license} · ${font.copyright} · ${font.licenseFile.dest} */\n` +
    `  src: url('../${file.dest}') format('${format}');\n  font-weight: ${file.weight || 400};\n  font-style: ${file.style || 'normal'};\n  font-display: block;\n}\n`;
}
