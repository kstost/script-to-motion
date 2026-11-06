#!/usr/bin/env node
/**
 * tts.mjs — narration and timeline for a script-to-motion project.
 *
 *   node tts.mjs <projectDir> [--approved] [--only c03,c07] [--force] [--placeholder]
 *
 * Reads <project>/script.json, synthesizes each cue with Fish Audio (cached by content hash),
 * trims edge silence, lays the cues end to end with gaps, and writes:
 *   audio/cues/<id>.wav        one file per cue
 *   audio/narration.wav        the full narration, t=0 aligned with the video's t=0
 *   audio/narration.mp3        same, compressed (if ffmpeg is available) — used by the player
 *   js/cues.js                 window.VIDEO_DATA: cue timings the scenes are anchored to
 *
 *   --approved     the user has approved the script (or asked for these takes): only then are new takes recorded.
 *                  Without it, cues that have no take yet get placeholder audio (silent, estimated timing) and nothing
 *                  is sent to Fish Audio — narration is never generated before the user approves it.
 *   --only ids     re-synthesize just these cues (new take), keep the rest from cache (needs --approved)
 *   --force        re-synthesize every cue
 *   --placeholder  no API calls: silent audio with estimated durations (for building visuals
 *                  before a key is available). Real takes already in the cache are still used.
 *
 * Narration is optional. "narration": false in script.json makes a video WITHOUT narration: no API call, silent
 * audio, each cue timed by its estimated reading time (the cues still drive the scenes).
 * Real narration needs BOTH, provided by the user — nothing is guessed or defaulted:
 *   voice  the user's Fish Audio voice model id: "voice" in script.json, else FISH_VOICE (environment or .env)
 *   key    FISH_API_KEY (or FISH_AUDIO_API_KEY) from the environment, else from a `.env` file in the
 *          project folder or any parent folder, else from the skill's own `.env` (git-ignored, where the user keeps
 *          their keys). The key is never copied into the project.
 * Model: drama-3 by default (directed in plain language: [directions], [sounds/pauses], <emphasis>…</emphasis>) —
 * https://docs.fish.audio/features/text-to-speech · …/text-to-speech/drama-3
 * Without them only "narration": false or --placeholder (temporary, flagged until replaced) runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const API = 'https://api.fish.audio/v1/tts';
const SR = 44100;
const DEFAULTS = {
  voice: '',            // the user's own Fish Audio voice model id — script.json "voice" or FISH_VOICE; never a default
  model: 'drama-3',     // the user's model; a missing/misspelt model header silently falls back to s2.1-pro
  temperature: 0.7,
  top_p: 0.7,
  leadIn: 0.6,
  gap: 0.45,
  tail: 1.5,
};

// ---------- args ----------
const argv = process.argv.slice(2);
const opt = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    opt[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  } else opt._.push(a);
}
const dir = path.resolve(opt._[0] || '.');
const only = typeof opt.only === 'string' ? new Set(opt.only.split(',').map((s) => s.trim())) : null;

function die(msg, code = 1) {
  console.error('✖ ' + msg);
  process.exit(code);
}

// ---------- script ----------
const scriptPath = path.join(dir, 'script.json');
if (!fs.existsSync(scriptPath)) die(`no script.json in ${dir}`);
let script;
try {
  script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
} catch (e) {
  die(`script.json is not valid JSON: ${e.message}`);
}
const cfg = { ...DEFAULTS };
for (const k of Object.keys(DEFAULTS)) if (script[k] != null) cfg[k] = script[k];
const cues = script.cues || [];
if (!cues.length) die('script.json has no cues');

const seen = new Set();
for (const [i, c] of cues.entries()) {
  if (!c.id || !/^[A-Za-z][A-Za-z0-9]*$/.test(c.id)) die(`cue #${i + 1}: id must be alphanumeric starting with a letter (got ${JSON.stringify(c.id)})`);
  if (seen.has(c.id)) die(`duplicate cue id ${c.id}`);
  seen.add(c.id);
  if (!c.say || !String(c.say).trim()) die(`cue ${c.id}: "say" is empty`);
}
if (only) for (const id of only) if (!seen.has(id)) die(`--only: unknown cue id ${id}`);
// the voice is never slowed down or sped up (the user's rule): no speed but 1, for the whole script or for a cue
const sped = [...((script.speed ?? 1) !== 1 ? [`script ×${script.speed}`] : []), ...cues.filter((c) => c.speed != null && c.speed !== 1).map((c) => `${c.id} ×${c.speed}`)];
if (sped.length) die(`speed must stay 1 (${sped.join(', ')}) — the voice is never slowed down or sped up. A rushed take gets pauses in its "say" (commas, "..." between sentences) or a fresh take`);

const stripTags = (s) => s.replace(/\[[^\]]*\]/g, '').replace(/<\|[^|]*\|>/g, '').replace(/<\/?[a-z]+>/gi, '').replace(/\s+/g, ' ').trim();

/** a setting from the environment, else from a .env file in the project or any parent directory */
const SKILL_ENV = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '.env');
function fromEnvFile(f, names) {
  if (!fs.existsSync(f)) return null;
  const txt = fs.readFileSync(f, 'utf8');
  for (const n of names) {
    const m = txt.match(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${n}[ \\t]*=[ \\t]*["']?([^"'\\s#]+)`, 'm'));
    if (m) return m[1];
  }
  return null;
}
function findSetting(names) {
  for (const n of names) if (process.env[n]) return process.env[n].trim();
  for (let d = dir; ; d = path.dirname(d)) {
    const v = fromEnvFile(path.join(d, '.env'), names);
    if (v) return v;
    if (path.dirname(d) === d) break;
  }
  return fromEnvFile(SKILL_ENV, names);
}
const silent = script.narration === false;   // a video without narration, by choice
const apiKey = findSetting(['FISH_API_KEY', 'FISH_AUDIO_API_KEY']);
if (!cfg.voice) cfg.voice = findSetting(['FISH_VOICE']) || '';
// real narration only with the user's own voice id AND key — never guess, borrow or default a voice
const missing = [!cfg.voice && 'the user\'s Fish Audio voice model id ("voice" in script.json, or FISH_VOICE=<id> in .env)',
  !apiKey && 'the user\'s Fish Audio API key (FISH_API_KEY=<key> in the environment or a .env file in the project or a parent folder)'].filter(Boolean);
if (missing.length && !opt.placeholder && !silent) {
  die(
    `Narration is made only with the user's own Fish Audio voice and key. Missing:\n  - ${missing.join('\n  - ')}\n` +
      '  The user didn\'t give them: make the video without narration ("narration": false in script.json), or, if they\n' +
      '  asked for a voiced video, ask for both and meanwhile build with --placeholder (temporary).',
    2,
  );
}

// ---------- audio helpers ----------
function wavBuffer(samples) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Fish returns raw 16-bit LE PCM for format "pcm"; tolerate a WAV header just in case. */
function toSamples(buf) {
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    let p = 12;
    while (p + 8 <= buf.length) {
      const id = buf.toString('ascii', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (id === 'data') {
        buf = buf.subarray(p + 8, Math.min(buf.length, p + 8 + (size || buf.length)));
        break;
      }
      p += 8 + size + (size & 1);
    }
  }
  const even = buf.length - (buf.length % 2);
  const copy = Buffer.from(buf.subarray(0, even));
  return new Int16Array(copy.buffer, copy.byteOffset, even / 2);
}

/** Cut leading/trailing silence so cue.start is when the voice actually begins. */
function trimSilence(s) {
  const thr = 400; // ≈ -38 dBFS
  let a = 0;
  let b = s.length - 1;
  while (a < s.length && Math.abs(s[a]) < thr) a++;
  while (b > a && Math.abs(s[b]) < thr) b--;
  if (a >= b) return s;
  a = Math.max(0, a - Math.round(0.04 * SR));
  b = Math.min(s.length - 1, b + Math.round(0.12 * SR));
  return s.slice(a, b + 1);
}

/** Rough speaking-time estimate for --placeholder (Korean ≈ 5.2 syllables/s). */
function estimateSeconds(say) {
  let pause = 0;
  for (const tag of say.match(/\[[^\]]*\]/g) || []) {
    if (/long-break/i.test(tag)) pause += 0.9;
    else if (/break/i.test(tag)) pause += 0.35;
  }
  const s = stripTags(say);
  const count = (re) => (s.match(re) || []).length;
  const secs =
    count(/[가-힣]/g) / 5.2 +
    count(/[A-Za-z]+/g) / 2.6 +
    count(/[0-9]/g) * 0.3 +
    count(/[぀-ヿ一-鿿]/g) / 6 +
    count(/[,、，]/g) * 0.2 +
    count(/[.!?。！？…]/g) * 0.35;
  return Math.max(0.6, secs + pause + 0.15);
}

// ---------- synthesis ----------
const cacheDir = path.join(dir, '.tts-cache');
fs.mkdirSync(cacheDir, { recursive: true });

function cacheKey(c) {
  const p = {
    v: 1,
    model: cfg.model,
    voice: cfg.voice,
    say: c.say,
    speed: 1,   // always 1 (kept in the key so the takes recorded before the rule stay valid)
    temperature: cfg.temperature,
    top_p: cfg.top_p,
    sr: SR,
  };
  return crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 24);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function synthesize(c) {
  const body = {
    text: c.say,
    reference_id: cfg.voice,
    format: 'pcm',
    sample_rate: SR,
    latency: 'normal',
    temperature: cfg.temperature,
    top_p: cfg.top_p,
    prosody: { speed: 1, volume: 0 },
  };
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', model: cfg.model },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      if (attempt >= 4) throw new Error(`network error: ${err.message}`);
      await sleep(2000 * 2 ** (attempt - 1));
      continue;
    }
    if (res.ok) return toSamples(Buffer.from(await res.arrayBuffer()));
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 401) throw new Error('401 unauthorized — FISH_API_KEY is invalid');
    if (res.status === 402) throw new Error('402 payment required — the Fish Audio account is out of credit');
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 4) {
      await sleep(2000 * 2 ** (attempt - 1));
      continue;
    }
    throw new Error(`HTTP ${res.status} ${detail}`);
  }
}

let fresh = 0;
let cached = 0;
let placeholders = 0;

// narration is recorded only after the user approved it (--approved); before that, new cues get placeholders
const approved = opt.approved === true;
if ((opt.force || only) && !approved && !silent && !opt.placeholder) {
  die('--force / --only record new takes: add --approved once the user has approved these lines (or asked for the re-take)');
}
let unapproved = 0;

async function takeFor(c) {
  const key = cacheKey(c);
  const file = path.join(cacheDir, key + '.pcm');
  const wantNew = opt.force || (only && only.has(c.id));
  // no narration by choice: silent, timed by estimated reading — never a cached voice take
  if (silent) return { samples: new Int16Array(Math.round(estimateSeconds(c.say) * SR)), placeholder: false, silent: true, key };
  if (!wantNew && fs.existsSync(file)) {
    cached++;
    return { samples: toSamples(fs.readFileSync(file)), placeholder: false, key };
  }
  if (opt.placeholder || !approved) {
    placeholders++;
    if (!opt.placeholder) unapproved++;
    return { samples: new Int16Array(Math.round(estimateSeconds(c.say) * SR)), placeholder: true, key };
  }
  const raw = await synthesize(c);
  const samples = trimSilence(raw);
  if (samples.length < SR * 0.2) throw new Error(`cue ${c.id}: synthesized audio is empty or too short`);
  fs.writeFileSync(file, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  fresh++;
  process.stdout.write(`  ✓ ${c.id} (${(samples.length / SR).toFixed(2)}s)\n`);
  return { samples, placeholder: false, key };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

let takes;
try {
  takes = await mapLimit(cues, 3, takeFor);
} catch (err) {
  die(err.message);
}

// ---------- duration sanity (local only — audio is never sent anywhere for transcription) ----------
const flagged = [];
cues.forEach((c, i) => {
  const take = takes[i];
  if (take.placeholder || take.silent) return;
  const secs = take.samples.length / SR;
  const est = estimateSeconds(c.say);
  if (secs > est * 1.8 + 0.5) flagged.push(`${c.id}: ${secs.toFixed(1)}s but ~${est.toFixed(1)}s expected — possible repetition or garbage at the end`);
  else if (secs < est * 0.5) flagged.push(`${c.id}: ${secs.toFixed(1)}s but ~${est.toFixed(1)}s expected — words may be missing`);
});

// ---------- timeline ----------
const r3 = (x) => Math.round(x * 1000) / 1000;
let cursor = cfg.leadIn;
const timeline = cues.map((c, i) => {
  const duration = r3(takes[i].samples.length / SR);
  const start = r3(cursor);
  const end = r3(start + duration);
  cursor = end + (c.gapAfter ?? cfg.gap);
  const cueOut = { id: c.id, text: c.text ? String(c.text) : stripTags(c.say), say: c.say, start, end, duration };
  if (Array.isArray(c.captions) && c.captions.length) cueOut.captions = c.captions.map(String); // one-line caption segments, chosen by hand
  return cueOut;
});
const audioDuration = timeline[timeline.length - 1].end;
const duration = r3(audioDuration + cfg.tail);

// ---------- write audio ----------
const audioDir = path.join(dir, 'audio');
const cueDir = path.join(audioDir, 'cues');
fs.mkdirSync(cueDir, { recursive: true });
for (const f of fs.readdirSync(cueDir)) if (f.endsWith('.wav')) fs.unlinkSync(path.join(cueDir, f));

const mix = new Int16Array(Math.ceil(audioDuration * SR) + 1);
timeline.forEach((c, i) => {
  const s = takes[i].samples;
  fs.writeFileSync(path.join(cueDir, `${c.id}.wav`), wavBuffer(s));
  mix.set(s.subarray(0, Math.max(0, mix.length - Math.round(c.start * SR))), Math.round(c.start * SR));
});
const wavPath = path.join(audioDir, 'narration.wav');
const mp3Path = path.join(audioDir, 'narration.mp3');
fs.writeFileSync(wavPath, wavBuffer(mix));
if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);

let runtimeAudio = 'audio/narration.wav';
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '192k', mp3Path]);
if (!ff.error && ff.status === 0) runtimeAudio = 'audio/narration.mp3';
else console.warn('⚠ ffmpeg unavailable or failed — the player will use narration.wav');

// ---------- write js/cues.js ----------
const data = {
  title: script.title || '',
  lang: script.lang || 'ko',
  audio: runtimeAudio,
  audioDuration,
  duration,
  leadIn: cfg.leadIn,
  tail: cfg.tail,
  placeholder: takes.some((t) => t.placeholder),
  narration: !silent,
  voice: silent ? '' : cfg.voice,
  model: cfg.model,
  cues: timeline,
};
fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
fs.writeFileSync(
  path.join(dir, 'js', 'cues.js'),
  '// Generated by tts.mjs from script.json — edit script.json and re-run instead of editing this file.\n' +
    `window.VIDEO_DATA = ${JSON.stringify(data, null, 2)};\n`,
);

// ---------- report ----------
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
console.log('');
for (const c of timeline) {
  console.log(`${c.id.padEnd(6)} ${c.start.toFixed(2).padStart(7)} → ${c.end.toFixed(2).padStart(7)}  (${c.duration.toFixed(2)}s)  ${clip(c.text, 60)}`);
}
console.log('');
console.log(
  `narration ${runtimeAudio} ${audioDuration.toFixed(2)}s · video ${duration.toFixed(2)}s · ` +
    `${cues.length} cues (${fresh} new, ${cached} cached${placeholders ? `, ${placeholders} PLACEHOLDER` : ''})`,
);
if (flagged.length) {
  console.log('\n⚠ unusual durations — ask the user to listen to these (audio/cues/<id>.wav); re-take with --only <ids>:');
  for (const f of flagged) console.log('  - ' + f);
}
if (silent) console.log('· no narration ("narration": false): silent audio, each cue timed by its estimated reading time. To voice it later: the user gives their Fish Audio voice id + API key, set "narration": true, run tts.mjs again — the scenes follow the new timings.');
if (unapproved) console.log(`⏸ ${unapproved} cue(s) not recorded: narration is generated only after the user approves it. Show them the lines (text), and once they approve run: node tts.mjs <dir> --approved — until then those cues are silent placeholders with estimated timing.`);
else if (placeholders) console.log('⚠ placeholder narration is silent with estimated timing — re-run without --placeholder once the user has given their Fish Audio voice id and API key.');
