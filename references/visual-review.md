# Visual review — looking at the video through the browser

You can't watch the video, but headless Chromium can render any moment of it exactly as a viewer's
Chrome would. This is the loop that turns "it should look right" into "I looked, and it does".
Budget: the default pass takes seconds; a full review with overview + motion under a minute. Don't skip it.

> **When to look, and when not.** Snapshots are for the first build and for moments the user asks you to look at.
> During the user's review rounds they judge the picture themselves ("확인은 사용자가 하고 피드백을 줄것이다"): implement,
> run `check.mjs` + `errscan.mjs` (runtime errors across the whole timeline, no screenshots), and hand over
> (references/collaboration.md). Footage shows in snapshots only after `stills.mjs` has cut its frames
> (references/footage.md §4).

## Contents
1. Tools at a glance
2. The review loop
3. What to look at in every frame
4. Reading the automatic warnings
5. Checking sync by eye
6. Iterating: before / after (6b. Shader FX beats)
7. What the browser can't tell you

---

## 1. Tools at a glance

```bash
S=<skill>/scripts
node $S/snapshot.mjs <dir>                          # one frame per cue (+ first/last) — the default pass
node $S/snapshot.mjs <dir> --overview               # whole video as thumbnails (rhythm, variety, static stretches)
node $S/snapshot.mjs <dir> --cues c02,c08           # start / middle / end of specific cues
node $S/snapshot.mjs <dir> --range 7.0:8.4 --step 0.1   # filmstrip of one motion (walk, punch-in, transition)
node $S/snapshot.mjs <dir> --times 7.3 --crop 600,300,700,400   # a detail at 2×
node $S/snapshot.mjs <dir> --times 34.4 --scale 2   # 4K sharpness
node $S/snapshot.mjs <dir> --perf                   # JS cost per frame
node $S/snapshot.mjs <dir> --overview --seekcheck   # determinism: each shot again (reverse, then shuffled order) must match
node $S/snapshot.mjs <dir> --safezone               # unsafe margins drawn on the frames, text inside them warned
node $S/snapshot.mjs <dir> --captions --cues c06    # with the player's captions on (one-line segments)
```

Every run writes `sheet-N.png` (contact sheets — open them and look), `t-*.png` (single frames),
`review.html` (the same frames with labels and warnings, for the user) and `report.json`.
Each frame is labelled `t=… · cue` plus **the words being spoken** at that moment (`▸` marks the
estimated position). Orange-framed cells have layout warnings.

No browser yet? See browser-setup.md (`node $S/setup_browser.mjs`).

## 2. The review loop

1. **Default pass** — `snapshot.mjs <dir>`. Read every sheet, cue by cue, against storyboard.md.
2. **Rhythm pass** — `--overview`. On the overview sheet the whole piece is one picture:
   is there variety of framing, scale and colour, or the same layout over and over? Does the colour/camera
   escalate with the story? Find the static stretches yourself: neighbouring thumbnails that look the same for
   1.5 s or more are dead air to fix, unless the stillness is a deliberate beat.
3. **Key moments** — for every beat the story depends on (an encounter, a reveal, a punch-in, the joke's
   payoff), shoot `--cues` or a `--range` filmstrip around it and check that the moment happens **on
   screen, while it is being said**. One frame per cue easily misses a camera that leaves too early or an
   element that appears after the words.
4. **Details** — `--crop` the small things the script is about (a mouth corner, a number, an icon) and
   `--scale 2` one or two frames to confirm 4K sharpness.
5. **Transitions, frame by frame.** For every scene change and every camera or scale move, shoot
   `--range a:b --step 0.05`, cropped if useful. Look for one-frame jumps (a changed `transform-origin`),
   elements flashing their default state before their entrance, two scenes muddily overlapping, and
   dim or highlight states you couldn't explain in a sentence. The user watches at 0.5-second scrub
   steps and will see all of these.
6. **Fix, then re-shoot the same times** with before/after (section 6). Repeat until a pass finds nothing.
7. **Hand off** with the path to `review.html` so the user can look at the same frames.

## 3. What to look at in every frame

- **Not a slide**: strip the motion away. Would this frame pass as a PPT slide or a document page (a title bar,
  cards or panels of text, bullets, a table, boxes with arrows)? Then the scene is rebuilt, not polished
  (SKILL.md → No slides, no boxes).
- **Story**: does the frame show what the storyboard promises for this cue? Is the key word/number the
  biggest thing on screen *now*?
- **Focus**: one clear focal point; nothing important under the HUD, off the edge, or behind another element.
- **Text**: large enough, readable contrast, not overlapping, not cut, sensible line breaks (Korean words
  not split), no orphaned single syllable.
- **Attached things stay attached**: in every camera/parent move, a light's glow and flare stay on the
  light, a weight on its rope, a label on its object (filmstrip at `--step 0.1`).
- **Effects that are physically right**: lens flares only on lights a camera would see (none on a light
  seen from under water — there it's a soft diffuse glow); bubbles rise, dust settles, shadows fall away
  from the light.
- **Procedural shapes look natural at 2×**: clouds, rocks, smoke, splashes, "bulges" and other generated
  detail — `--crop … --scale 2` once; uniform domes, flat cut-off bases, outline strokes on soft things and
  detached blobs read as mistakes (a pressure bulge beside a finger read as ears).
- **Decorative type counts as text**: giant outline/ghost words (HADAL, MIDNIGHT) behind labels are text
  for the overlap warning — a label on top of their strokes needs its own backing or another place.
- **Clipped glows**: faint coloured rectangles/boxes behind individual characters or digits mean a
  `text-shadow` is being cut by a SplitText mask or an `overflow: hidden` digit box (player-api.md §4). It is
  subtle at contact-sheet size and shows up on dark backgrounds in the final recording: `--crop` every glowing
  headline and hero number at `--scale 2` once it has finished animating in.
- **Expressive type** (type-fx.md): the line is readable and still while it is spoken; the break, melt or
  dissolve lands on the stressed word, not after it; the swap from text to its copies/outlines/pixels is
  invisible (filmstrip `--step 0.05` across it); pieces and dust leave the frame or fade, so no debris is left in
  the next shot; the effect fits the line's meaning and the piece's material.
- **Acting**: gaze direction, brows and mouth read at this size; characters face the right way.
- **Composition**: balanced, safe margins, intentional empty space vs accidental emptiness.
- **Continuity**: persistent elements (HUD, counters, colours) show the right state for this point.
- **Transitions** (in filmstrips): no ugly mid-states, no flash of the wrong layout, no element popping
  in late or lingering after its exit.
- **First and last frame**: both intentional — the first shows while fullscreen settles, the last holds.

## 4. Reading the automatic warnings

Measured by the browser on what is actually visible (clipping and masks taken into account):

| warning | usually means | intentional when |
|---|---|---|
| text overlaps text | two labels collide | a caption deliberately placed over a balloon (rare) |
| text clipped by its container | caption touching a panel/card border, box too small | never at rest — fix it |
| text cut by screen edge | layout past the safe area | a previous panel scrolling away, a deliberately cropped close-up, mid-transition |
| text in the unsafe … margin | text inside `--safe*` (in 9:16: under the Shorts/Reels/TikTok UI) | a full-bleed background word that is decoration, not reading |
| glow clipped into a box | a light `text-shadow` cut by a SplitText mask, digit column, `overflow`, `clip-path` or mask: faint rectangles behind the letters | never — move the glow to `filter: drop-shadow()` outside the clip (player-api.md §4) |

Decorative copies (`[data-fx-copy]`: TypeFX shards, glitch bands, extrusion layers, motion-blur ghosts, FXKit
glints), units of one TypeFX group crossing each other, and units an effect is moving are not reported.

`--seekcheck` reaches every shot again, in reverse order and then in a fixed shuffled order (`--seed N`, default 1),
and compares the picture: a hash of the screenshot, then the pixels (it reports how many differ and where). The
element and property that changed are listed when the computed styles show it; "no listed property explains it" means
something outside that list (an SVG attribute like `cx`, a `box-shadow`, a background) — look at the reported area.
A difference means something depends on what was played before or on the path of seeks: accumulated state,
`Math.random` or `Date`, a cache that skips a needed write, or a timeline callback. Never ship with one.

Also read the console errors — a page error means some animation never ran. `errscan.mjs` also lists every file the
page asked for and didn't get (a missing `js/art/*.js`, `<img>`, stylesheet) and footage whose stills haven't been cut
(run `stills.mjs`).

## 5. Checking sync by eye

The `▸` in each label is where the voice is estimated to be (by character position within the cue, ±0.3 s).
The visual should land **with or slightly before** the words it illustrates. When a moment matters,
shoot a `--range` across the phrase at `--step 0.1` and find the first frame where the element is readable:
it should be at or before the frame whose label reaches that word.

## 6. Iterating: before / after

```bash
node $S/snapshot.mjs <dir> --cues c02 --out <dir>/.snapshots/before
# … fix …
node $S/snapshot.mjs <dir> --cues c02 --out <dir>/.snapshots/after --compare <dir>/.snapshots/before
```
`compare-N.png` shows BEFORE | AFTER side by side for the same times.

## 6b. Shader FX beats

- Shoot every FX peak (glow, slam, rays, focus pull, shaped transition) with `--range a:b --step 0.05`: the
  effect must land on the word, then settle; an effect that is still rising after the word reads as late.
- A frame that is one flat colour, or two different times that look identical, means the FX canvas isn't
  rendering or isn't receiving `t` — check `fx.render(t)` in `onFrame` and the console.
- Class-C effects (afterImage, motionBlur, traa) look approximate in single seeks; judge them in an ordered
  `--range` filmstrip, and say so in the hand-off if the trail matters.
- Text drawn into 3D (`textTexture`) must show every syllable — a ☐ means the glyphs weren't loaded.
- GPU cost isn't visible here (software rendering). Name the heavy FX beats in the hand-off and mention `?fxq=0.75`.

## 7. What the browser can't tell you

- **Smoothness**: headless machines usually have no GPU. `--perf` shows JS cost per frame during
  playback (sequential 1/30 s steps — keep p95 well under ~8 ms) and, separately, random-seek cost
  (scrubbing; often several times higher and not what the recording sees). Compositing/GPU cost is only
  visible on the user's machine.
- **Audio**: you can't hear takes or sync; the labels are estimates.
- **Safari/Firefox** differences (clip-path, text stroke, fonts).

Say these limits in the hand-off, and ask the user to watch the moments that depend on them (D shows the
debug bar with time and cue, so they can point at an exact moment).
