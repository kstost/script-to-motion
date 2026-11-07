# Sound — no dead air, timing to the word, subtitles and dubbed tracks

What the viewer hears is the narration plus the footage's own sound. This file covers the rules for that mix and the
files made from it for publishing: measured word timing, the dead-air check, SRT subtitles and a dubbed audio track.

## Contents
1. No dead air (the user's rule)
2. Timing visuals to the word: `sync.mjs`
3. Gaps, chapter windows and re-timing
4. Loudness
5. Subtitles: `subs.mjs`
6. Dubbed audio track: `dub.mjs`
7. Reporting numbers

## 1. No dead air (the user's rule)

**No silence of 0.7 s or longer anywhere in the finished sound** — narration and footage together; room tone too quiet
to hear counts as silence. The user trims every such gap when editing by hand and called a 9 s pause after an episode
"너무한다".

- The one exception: pauses **inside** footage the video shows whole (a generated clip's own beats between lines). Never
  cut inside it. Where a clip ends on a silent hold, start the next line over the hold while the picture plays out.
- Check after every re-timing, new take, chapter change or clip move:
  ```bash
  node <skill>/scripts/silence.mjs <dir>        # ✖ = dead air outside clips (exit 1) · inside clips are listed, allowed
  ```
  - **The end hold is not dead air**: from the last sound to the video's end (`tail`, the last frame holding) is printed
    as an info line (`· … end hold`). Gaps between sounds and the start before the first line are judged.
  - **Placeholder cues** (`placeholder: true` in `js/cues.js`: silent, not recorded yet) count as sound, so the gaps
    around them are still judged; they are listed as not checked. Run it again after recording.
  - Exit 2 means it couldn't check (no ffmpeg, a file that doesn't decode) — not a pass.
- Fix with `gapAfter` (script.json), the chapter window rule (§3), or by laying a line over a clip's silent tail — not
  by inserting sound effects.

## 2. Timing visuals to the word: `sync.mjs`

`cue(id).when('phrase')` estimates by character position until the takes are measured:

```bash
node <skill>/scripts/sync.mjs <dir>     # after tts.mjs; again after any new take
```

It reads each take's loudness envelope (no transcription — nothing leaves the machine), snaps commas and full stops to
the real pauses, and pairs the screen text with the spoken text word by word ("1,000억" ↔ "천억"). From then on
`when()` returns the moment the phrase's first syllable starts — numbers land on the word that says them, a highlighter
sweeps exactly under the spoken word. A take that changed without re-running sync falls back to the estimate and warns
(player console, check.mjs, errscan.mjs). Placeholder cues (not recorded yet) are skipped and keep the estimate; run
`sync.mjs` again once they are recorded.

## 3. Gaps, chapter windows and re-timing

- Defaults (`new_project.mjs`, `tts.mjs`): `leadIn` 0.6 s, `gap` 0.45 s between lines, `tail` 1.5 s — the end hold,
  where the last frame holds after the last line (not dead air, §1).
- **The silence you hear is longer than the gap.** Every take keeps ≈ 0.04 s before and ≈ 0.12 s after the voice (edge
  silence is trimmed at −38 dBFS), so between two lines there is ≈ gap + 0.16 s of silence. Measured with test-tone
  takes (`silence.mjs`, the worst case — a real voice's soft tail shortens it a little): `gapAfter` 0.40 → 0.56 s,
  0.45 → 0.60 s, 0.50 → 0.64 s, 0.54 → 0.68 s, **0.55 → 0.70 s ✖**, 0.60 → 0.76 s ✖. The default `leadIn` 0.6 s gives
  0.64 s before the first line.
- `gapAfter` **0.4–0.5 s** for a breath at a scene change or after a question — never above 0.54 s: from there on it is
  dead air unless something sounds in it.
- Changing gaps re-times without new API calls: edit script.json, run `tts.mjs` (unchanged takes come from the cache),
  then `sync.mjs`, `check.mjs`, `silence.mjs`.
- Chapter transitions (long-form.md) start `lead` s before the chapter's first line but never more than 0.25 s before the
  previous line ends — the transition plays under the end of the last sentence, not in a silent gap.
- A hook that plays an output (an episode, a demo) starts it right after the line that introduces it
  ("먼저 보시죠" → the clip starts 0.15 s after the line ends) and the next line starts as soon as the clip's sound ends.

## 4. Loudness

- Fish takes come out around −22 LUFS integrated; that is the reference (`MEDIA_SRC.level`). Footage is level-matched
  to it per clip (`lufs`), then shaped by its envelope (references/footage.md §7).
- A finished mix for upload: speech compressor (`acompressor=threshold=0.1:ratio=3:attack=5:release=150:knee=4`), make-up
  gain to −16 LUFS integrated, limiter at −2 dBFS (`alimiter=limit=0.79`). `dub.mjs` masters this way; use the same chain
  for any other exported mix so tracks match.

## 5. Subtitles: `subs.mjs`

YouTube takes SRT per language. The captions are burned into a screen recording only if the user records with them on;
an SRT is still worth uploading (search, accessibility, auto-translate source).

```bash
node <skill>/scripts/subs.mjs <dir> --out ../업로드 --name <video>      # → <video>.ko.srt, <video>.en.srt …
```

`<dir>/subs.json` holds the other languages and lines that aren't narration:

```json
{ "lang": "ko",
  "translations": { "en": { "op01": "These days in China, they say …", "op02": "…" } },
  "extra": [ { "after": "op02", "offset": 0.15, "lines": [[4.1, 6.75, { "ko": "우리 딸 데려가겠다는 사람이 그 차림으로 와?", "en": "You come dressed like that, wanting to marry my daughter?" }]] } ] }
```

- Translate meaning, not words: idioms become their natural English ("고구마 구간" → "builds up the frustration").
  Keep names consistent with the on-screen spelling (Seoa).
- `extra` lines are anchored to a cue's end, so re-timing moves them with the narration. Use them for dialogue inside a
  clip (the drama's own lines) — the viewer of the English track needs them most.
- Re-run after every script change; `check.mjs` warns when a translation is missing a cue.

## 6. Dubbed audio track: `dub.mjs`

YouTube can carry extra audio tracks per language. A dub is the narration re-recorded in that language with **the same
voice**, each line placed where the original line starts, mixed with the footage's own sound exactly as the player
plays it, the same length as the video.

```bash
node <skill>/scripts/dub.mjs <dir> --lang en --init       # dub/en/script.json from subs.json translations
#   edit "say": spoken forms (Kling 4.0 → "Kling four point oh", 1080p → "ten-eighty p", 21:9 → "twenty-one by nine",
#   @ → "an at sign", 95% → "ninety-five percent"); translate the expression tags; keep them sparse
node <skill>/scripts/tts.mjs <dir>/dub/en                  # silent placeholders with estimated timing — no API call
node <skill>/scripts/dub.mjs <dir> --lang en --report      # how every line fits its room (estimates until recorded)
node <skill>/scripts/tts.mjs <dir>/dub/en --approved       # once the user decided to record the dub (key, voice, drama-3)
node <skill>/scripts/dub.mjs <dir> --lang en --report      # the recorded fit; reword, re-take
node <skill>/scripts/dub.mjs <dir> --lang en --out ../업로드/<video>.en.wav
```

The track is built only from recorded, current takes: `dub.mjs` refuses while any line is a placeholder (it would be
silent there), when the dub's `script.json` is `"narration": false`, or when a `say` changed since `tts.mjs` ran (stale
takes). `--report` works on placeholders and marks their lengths as estimates.

**Fitting the lines — what the Kling dub taught us**
- English runs ~15–30 % longer than Korean for the same meaning. Write the dub `say` **for the room**, not as a copy of
  the subtitle: the subtitle can be complete, the dub line must fit. Mandatory claims stay exact (a sponsor's required
  sentence, prices, numbers).
- **The voice is never slowed down or sped up** — no TTS speed and no `<fast>`/`<slow>` tags (tts.mjs refuses both) and
  no time-stretch in the mix: every take plays exactly as recorded. A line longer than its room is refused with its id;
  reword it shorter.
- Takes vary ±10 % between recordings of the same text, so a re-take can fit where the first didn't. The cache keeps
  only the latest take of a line — a re-take (`--only <id>`) overwrites it. To compare, copy `audio/cues/<id>.wav` (to
  listen) and `.tts-cache/` (to go back) aside before the re-take; restoring that `.tts-cache/` and re-running `tts.mjs`
  brings the earlier take back.
- Too short is a problem too: a line that leaves ≥ 0.66 s of air before the next one is dead air (§1). `--report` lists
  them; lengthen their wording naturally ("…, which is roughly fifteen billion US dollars,").
- A take may start up to 0.3 s before the original line when the air there is free; it never runs into the footage's own
  sound that comes up after the original line (dialogue in a clip).
- The footage's sound stays in its own language (the drama's Korean dialogue) — the subtitles carry it.
- Check the result with `ffmpeg -af silencedetect=noise=-42dB:d=0.7` outside the clips (the end hold excepted), and its
  length against the video.

## 7. Reporting numbers

When you hand over audio, report **every** factor that changes it: early starts, level changes, re-takes and why. There is
never a speed factor to report — no TTS speed, no time-stretch, no playback rate on anything with sound. Say what the user should listen to first (the lines with the largest change, numbers and
names, tags).
