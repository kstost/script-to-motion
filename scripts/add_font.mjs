#!/usr/bin/env node
/**
 * add_font.mjs — install a font into a project. SIL OFL 1.1 fonts only, from two sources:
 *
 *   node add_font.mjs <projectDir> <id> [<id> …]                  catalogue fonts (pinned, recommended): gowun-batang …
 *   node add_font.mjs <projectDir> "Do Hyeon" "Anybody" …          any Google Fonts family in its ofl/ directory
 *   node add_font.mjs <projectDir> "Gothic A1" --weights 400,800   static families: only these weights
 *   node add_font.mjs <projectDir> "Tilt Warp" --token --tilt      also add a CSS token to :root
 *   node add_font.mjs --list                                       the catalogue + where to find more (references/fonts.md)
 *
 * Catalogue fonts: assets/fonts/catalog.json pins each file's official URL and sha256.
 * Google Fonts: the family must live in google/fonts ofl/ (Apache/UFL families are refused), METADATA.pb must say OFL,
 * and its OFL.txt must be the SIL OFL 1.1 text. The google/fonts commit and the sha256 of every installed file are
 * recorded in fonts/fonts.lock.json, so the project can be checked and reproduced.
 * Either way the files are downloaded on demand (cached in ~/.cache/motion-video-fonts), copied unmodified with the
 * licence into fonts/<id>/, and @font-face rules are written to css/fonts.css (linked from index.html).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog, faceCss, fontFaces } from './lib/fonts.mjs';
import { installFonts, REQUIRED_LICENSE } from './lib/fontfetch.mjs';
import { installGoogleFont } from './lib/gfonts.mjs';

const catalog = loadCatalog();
const argv = process.argv.slice(2);
const opt = { _: [] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  else opt._.push(argv[i]);
}

if (!opt._.length || opt.list || opt.l) {
  console.log(`Fonts — ${REQUIRED_LICENSE} only. Two sources: this catalogue (pinned, recommended), and any Google Fonts family`);
  console.log('in its ofl/ directory (add it by its family name). Choosing by tone: references/fonts.md.\n');
  for (const f of catalog.fonts) {
    console.log(`${f.core ? '●' : '○'} ${f.id.padEnd(17)} ${`'${f.family}'`.padEnd(20)} ${f.category.padEnd(11)} Hangul ${String(f.hangul).padStart(5)} · ${f.license}`);
    console.log(`  ${f.role}`);
    console.log(`  stack: ${f.token}: ${f.stack};   tones: ${f.tones.join(', ')}\n`);
  }
  console.log('● core (in every project)   ○ node add_font.mjs <projectDir> <id>');
  console.log('Google Fonts: node add_font.mjs <projectDir> "Family Name" [--weights 400,700] [--token --name]');
  process.exit(0);
}

const dir = path.resolve(opt._[0]);
if (!fs.existsSync(path.join(dir, 'index.html'))) { console.error(`no index.html in ${dir}`); process.exit(2); }
const names = opt._.slice(1);
if (!names.length) { console.error('usage: node add_font.mjs <projectDir> <catalogue id | "Google Fonts family"> …   (see --list)'); process.exit(2); }
const weights = typeof opt.weights === 'string' ? opt.weights.split(',').map(Number).filter(Boolean) : null;

const declared = new Set(fontFaces(dir).map((f) => f.family.toLowerCase()));
const fontsCss = path.join(dir, 'css', 'fonts.css');
let css = fs.existsSync(fontsCss) ? fs.readFileSync(fontsCss, 'utf8')
  : '/* fonts.css — @font-face for fonts added with scripts/add_font.mjs (catalogue or Google Fonts OFL). Generated; don\'t add other fonts by hand. */\n';
let styleCss = fs.readFileSync(path.join(dir, 'css', 'style.css'), 'utf8');
const addToken = (token, stack, family, why) => {
  if (!new RegExp(`${token}\\s*:`).test(styleCss)) {
    styleCss = styleCss.replace(/:root\s*{/, (m) => `${m}\n  ${token}: ${stack};   /* ${family} — ${why} (add_font.mjs) */`);
  } else if (!styleCss.includes(stack)) console.log(`  note: ${token} already exists in style.css — to use ${family} set it to: ${stack}`);
};
const generic = (cat) => (/serif/i.test(cat) && !/sans/i.test(cat) ? 'serif' : /mono/i.test(cat) ? 'monospace' : /hand/i.test(cat) ? 'cursive' : 'sans-serif');

for (const name of names) {
  const font = catalog.fonts.find((f) => f.id === name) || catalog.fonts.find((f) => f.family.toLowerCase() === name.toLowerCase());
  try {
    if (font) {
      await installFonts(dir, [font]);
      if (!declared.has(font.family.toLowerCase())) {
        const block = font.files.filter((f) => !f.dest.endsWith('.css')).map((f) => faceCss(font, f)).join('');
        if (!css.includes(`font-family: '${font.family}'`)) css += `\n/* ${font.id} — ${font.role} */\n${block}`;
        declared.add(font.family.toLowerCase());
      }
      addToken(typeof opt.token === 'string' ? opt.token : font.token, font.stack, font.family, font.license);
      console.log(`✓ ${font.family} (${font.id}, catalogue) → fonts/${font.id}/ · ${font.license} · use var(${typeof opt.token === 'string' ? opt.token : font.token})`);
    } else {
      const e = await installGoogleFont(dir, name, { weights });
      if (!declared.has(e.family.toLowerCase())) {
        const block = e.files.map((f) => faceCss(e, f)).join('');
        css = css.replace(new RegExp(`\\n/\\* ${e.id} — Google Fonts[^\\n]*\\n(@font-face \\{[^}]*\\}\\n)+`, 'g'), '');
        css += `\n/* ${e.id} — Google Fonts ${e.path} @ ${e.commit.slice(0, 12)} · ${e.category} */\n${block}`;
        declared.add(e.family.toLowerCase());
      }
      const stack = `'${e.family}', 'Pretendard', ${generic(e.category)}`;
      if (typeof opt.token === 'string') addToken(opt.token, stack, e.family, e.license);
      const axes = e.axes.length ? ` · axes ${e.axes.map((a) => `${a.tag} ${a.min}–${a.max}`).join(', ')}` : '';
      const ko = e.subsets.includes('korean') ? ' · Hangul' : ' · no Hangul (Pretendard draws Korean)';
      const mb = (e.files.reduce((s, f) => s + f.bytes, 0) / 1048576).toFixed(1);
      console.log(`✓ ${e.family} (Google Fonts ${e.path}) → fonts/${e.id}/ · ${e.license} · ${e.files.length} file(s), ${mb} MB${axes}${ko}`);
      console.log(`  stack: ${stack}${typeof opt.token === 'string' ? `  → var(${opt.token})` : ''}`);
    }
  } catch (err) {
    console.error(`✖ ${err.message}`);
    process.exit(1);
  }
}
fs.writeFileSync(fontsCss, css);
fs.writeFileSync(path.join(dir, 'css', 'style.css'), styleCss);

// link css/fonts.css before style.css so tokens can use the families
const indexPath = path.join(dir, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!/href=["']css\/fonts\.css["']/.test(html)) {
  html = html.replace(/(\s*)<link rel="stylesheet" href="css\/style\.css">/, '$1<link rel="stylesheet" href="css/fonts.css">$1<link rel="stylesheet" href="css/style.css">');
  fs.writeFileSync(indexPath, html);
}
console.log('\nNext: use the family in style.css, then node check_fonts.mjs <projectDir> to prove every glyph is covered.');
