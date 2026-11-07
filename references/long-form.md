# Long videos — chapters, segment modules, one thread through 6–10 minutes

A 9-minute video is 100+ cues and thousands of tweens. One `scenes.js` stops being workable long before that. This is
the structure the Kling campaign video (9:14, 10 chapters, 103 cues) was built with.

## Contents
1. Story structure
2. Cue ids and chapters
3. Files: an integrator and one module per chapter
4. Chapter windows (and the same rule for YouTube chapters)
5. Shared helpers and devices
6. Chapter cards and the signature transition
7. Working on it with the user

## 1. Story structure

- **One big question stays open to the end; each chapter opens a small question and closes it.** Chapter titles are
  those questions ("Kling 4.0은 콘티대로 찍었을까?") — the same text becomes the chapter card in the video and the
  YouTube chapter in the description (sponsors often require question-style chapters).
- **One object travels through the whole video and keeps changing role** (a 9:16 storyboard card: the plan → the
  footage that fills it → a graded result → a price tag → an empty card for "episode 2" at the end). Per chapter, one
  concept object carries the numbers and words as its states (references/craft-notes.md).
- **Each chapter is its own world**: colour temperature, light source, background picture change; the devices stay.
- Something strong every 1–2 minutes: the best output, a new question, the price reveal.
- **Hook with the best finished output, played whole**, then say what the video will test.
- Bookend: the last image answers the first (the same composition, the same card).

## 2. Cue ids and chapters

Give every chapter a two-letter prefix and number its cues: `op01…op06`, `tr01…`, `kl01…`. A new line inserted later
gets a letter (`op04b`, `kl01b`) so nothing else renumbers. In script.json:

```json
"chapters": [ { "from": "op01", "title": "AI가 만든 60초 드라마, 배우 없이 어떻게 찍었을까?" },
              { "from": "tr01", "title": "AI 숏드라마는 왜 이렇게 쏟아질까?" } ]
```

## 3. Files: an integrator and one module per chapter

```
index.html        persistent layers + <div id="segs"></div> (chapters mount their scenes here) + the transition layer
js/scenes.js      the integrator: installs the kits, builds the shared helpers H, computes every chapter's window and
                  calls its builder
js/seg/op.js …    window.SEG.op = (ctx, K, TX, H, win) => { … }   one per chapter; owns its scenes and CSS
css/seg/op.css …  (optional) the chapter's own styles
```

```html
<script src="js/seg/op.js"></script> … <script src="js/seg/vd.js"></script>
<script src="js/scenes.js"></script>
```

```js
// js/seg/pv.js
window.SEG = window.SEG || {};
window.SEG.pv = (ctx, K, TX, H, win) => {
  const { tl, scene } = ctx, { S, E, w, mount } = H;
  const [el] = mount(`<section class="scene" id="pv-a">…</section>`);
  scene(el, win.a, win.b);
  // … everything timed from this chapter's cues and win.a / win.b
};
```

The integrator calls every builder inside `try { … } catch (err) { console.error(`[${seg}] segment failed`, err); }`, so
one broken chapter doesn't take the whole video down (errscan.mjs reports it). `check.mjs` reads `js/seg/*.js` like
`scenes.js` (syntax, determinism, cue ids, #ids).

## 4. Chapter windows (and the same rule for YouTube chapters)

```js
const ORDER = ['op', 'tr', 'kl', 'pl', 'fr', 'pv', 'rf', 'ed', 'mn', 'vd'];
const first = (seg) => ids.find((i) => i.startsWith(seg)), last = (seg) => [...ids].reverse().find((i) => i.startsWith(seg));
// the transition starts ~1 s before the chapter's first line, never more than 0.25 s before the previous line ends
const startOf = (k) => { const fk = first(ORDER[k]), pl = k > 0 && last(ORDER[k - 1]);
  return pl ? Math.max(S(fk) - 1.05, E(pl) - 0.25) : S(fk) - 1.05; };
ORDER.forEach((seg, i) => {
  const a = i === 0 ? 0 : startOf(i), b = ORDER[i + 1] ? startOf(i + 1) : data.duration;
  window.SEG[seg](ctx, K, TX, H, { id: seg, first: first(seg), last: last(seg), a, b });
});
```

`chapters.mjs <dir>` prints the YouTube timestamps with the same rule (`--lead 1.05 --overlap 0.25`), so the description
matches the cuts. Re-run it after any re-timing.

## 5. Shared helpers and devices

Put every device the storyboard names (the monitor, the browser window, the spot and callout, the plan card, the grade
marks, the price memo, chapter cards) in the integrator's `H`, so every chapter draws them the same way. Typical:

| helper | what |
|---|---|
| `S(id)` `E(id)` `w(id, '단어', off)` | cue start, end, the measured moment a phrase is spoken (`cue(id).when`) |
| `mount(html)` | append a chapter's scenes to `#segs`, return the elements |
| `track(state)` / `camera(el)` | non-overlapping keyframes on an object; a camera over a world div (RecKit has both) |
| `studio(kind)` | the backdrop set markup (css/look.css) |
| the devices | `monitor`, `browser`, `spot`, `callout`, `card`, `memo`, `chapterCard`, `slate`… |

A device lives in one place; a chapter that needs a variant passes options instead of copying it.

## 6. Chapter cards and the signature transition

Between chapters, one signature transition built from the video's concept (3–6 uses per video, not between every scene):
in the Kling video a small dashed plan card grows to the centre while the rest sinks into the dark, holds while the
chapter question is read on it, then opens past the edges turning solid — the plan becoming footage. The chapter card
shows the chapter number in handwriting, the question with its keyword largest, and a strip of the other chapters
receding to both sides (done ones with their image, coming ones as numbers). Closed-form in `onFrame` from t.

## 7. Working on it with the user

- Build **chapter by chapter** when the job is large and report progress as each one is done, without stopping for
  approval — the whole video gets finished; say so up front instead of shrinking the scope silently.
- Redesign requests mean rebuilding the chapter from a concept, not adding effects to the old frame
  (references/collaboration.md).
- Keep a progress file (`진행상황.md`) with decisions and their reasons, the file index and what's left — the next
  session starts from it.
