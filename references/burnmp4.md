# burnmp4.py — the MP4 and contact-sheet maker

`burnmp4.py` films a project frame by frame in a headless Chrome and writes either an **MP4** (default) or **contact
sheets** (`--screenshot`). It is one portable Python file: a copy sits at the root of every project (new_project.mjs puts
it there), and it runs from anywhere with the project folder (or its `index.html`) as the argument. The user runs it; you
don't render videos yourself unless asked (collaboration.md §4). `python3 burnmp4.py --help` lists every option.

## Contents
1. How it films a page
2. MP4 mode (short)
3. Contact sheets (`--screenshot`)
4. Reading a sheet in a review
5. Resume, stale chunks, fonts, footage
6. What it needs

## 1. How it films a page
- A local web server serves the project; Chrome opens `index.html?render&captions…` — the player hides its UI
  (`body.vp-render`), and the page reports `Video.renderReady` once built (player-api.md §6).
- For every frame n it seeks to t = n / fps, waits while `Video.renderBusy()` is true (everything registered with
  `busy(fn)` — e.g. footage frames still decoding), seeks again, waits two animation frames, then captures; by default it
  captures until two shots agree (`--fast`: one shot). Nothing plays in real time, so a slow machine only takes longer.
- Anything that finishes drawing after a seek must be registered with `busy(fn)` (SKILL.md, player-api.md §4), or the
  capture can catch it half-drawn.
- Stage size comes from `#stage data-width/data-height`; `--res` draws the same layout with fewer or more pixels
  (device pixel ratio 4/9, 2/3, 1, 2 → 480p, 720p, 1080p, 4K).

## 2. MP4 mode (short)
`python3 burnmp4.py <dir> [--from s] [--to s] [--res 480p|720p|1080p|4k] [--fps 60] [--fast] [--jobs N] [--out file]`
→ `<dir>/movie.mp4` with captions burned in and the narration of the stretch (plus the sound of clips with
`audio: true`, mixed as the player plays them). Chunks of `--chunk` seconds render in parallel (`--jobs`) and resume after
Ctrl+C. On a Mac: Metal drawing and VideoToolbox encoding. README 「MP4로 굽기」 has the user-facing details.

## 3. Contact sheets (`--screenshot`)
Every `--gapframe`-th frame of the range is captured at **480p** and laid out on a grid, one image per sheet. The user's
guide (Korean, step by step, recipes, troubleshooting) is `docs/screenshot.md` — point the user there.

| option | meaning (default) |
|---|---|
| `--screenshot` | sheets instead of an MP4 |
| `--gapframe N` | one tile every N frames (30). At 60 fps: 1 = every frame, 6 = 0.1 s, 30 = 0.5 s, 60 = 1 s, 300 = 5 s |
| `--from` / `--to` | the range in seconds (whole video) |
| `--cols` / `--rows` | tiles per sheet (landscape 4 × 6, portrait 8 × 3); more tiles → more sheets |
| `--fps` | the frame rate frame numbers and the gap count in (60) |
| `--out DIR` | where the sheets go (`<dir>/screenshots/`) |
| `--png` | lossless (JPEG quality 90) |
| `--no-captions` | captions off (on) |
| `--jobs`, `--fast`, `--no-gpu`, `--no-font-check` | as in MP4 mode |
| `--progress` | show progress while it works (off: stdout carries only the finished sheets' full paths, one per line; errors and warnings go to stderr) |

**A video file** (`burnmp4.py clip.mov --screenshot …` — mp4, mov, m4v, mkv, webm, avi): the same sheets from the file's
own frames, cut with ffmpeg (no project, no browser drawing): frame numbers and `--gapframe` in the file's fps (`--fps`
overrides), tiles 480 px high in the file's own shape (landscape 4 × 6, portrait 8 × 3), labels frame · time (no cue),
sheets in `screenshots/` next to the file as `<name>_<from>-<to>_g<gap>_<k>.jpg` (only that file's earlier sheets are
cleared). Sheets only — a video file can't be made into an MP4 here.

Not used in this mode: `--res` (always 480p), `--codec`, `--quality`, `--encoder`, `--no-audio`, `--chunk` (one sheet is
one job). No ffmpeg is needed for a project's sheets (a video file's sheets need it).

**A sheet:** a header line (project · first–last tile time · gap · sheet k/N), then the tiles left to right, top to
bottom. Tiles are 854×480 (landscape) or 480×854 (portrait), outlined on a mid-grey ground; a landscape 4×6 sheet is about
3500×3250 px, a portrait 8×3 sheet about 4000×2800 px. Under each tile: `frame  m:ss.ff  [cue]` — the frame number from
the start of the video (at `--fps`, from 0), the time in the same form the player's `S` key copies, and the id of the cue
being spoken at that time (the last cue that started). Labels are set in the project's own installed fonts (D2Coding,
Pretendard) — the sheet page loads the project's `@font-face` rules.

**Files:** `screenshots/<from>-<to>_g<gap>_<k>.jpg`, e.g. `0m08.00s-0m15.00s_g5_01.jpg`. **Every run empties
`screenshots/`** once its own sheets are made (a stopped or failed run leaves the earlier ones), so the folder always holds
just the latest sheets — the ones to open. A folder given with `--out` is not wiped: only earlier sheet files (that name
pattern) in it are removed. `check.mjs` skips `screenshots/` (it is review output, not content);
put it in the project's `.gitignore`.

**Size and time:** tiles = range (s) × fps ÷ gap; sheets = tiles ÷ (cols × rows), rounded up. Time grows with the tiles,
plus one page load per sheet. A 41-minute video at `--gapframe 300` is about 490 tiles, 21 sheets.

**Choosing the gap**

| to see | gap at 60 fps |
|---|---|
| a transition, a flash, a one-frame jump, text colliding | 1–6 over 1–3 s |
| how one beat enters, holds and leaves | 15–30 over the beat |
| the build of a chapter | 60–120 |
| the whole video at a glance | 300+ |

## 4. Reading a sheet in a review
- When the user wants to look at a stretch together (or asks you to look), suggest the exact command — the range around
  their note, a gap from the table — and open the sheet images they made (they are ordinary image files; the shared folder
  makes them readable here). Don't make sheets on your own during review rounds (collaboration.md §3).
- The player's **A** key copies that command for the moment on screen: `--screenshot --from t−1 --to t+1 --gapframe 10
  --fast --jobs 4 (check it with burnmp4.py from the script-to-motion skill)` (clamped to the video; no project name). The
  note in parentheses is for an agent it is pasted to: run `python3 burnmp4.py <dir>` with the options before it (in a
  terminal the user pastes it after `python3 burnmp4.py ` in the project folder, without the parenthesis). Without
  `--progress` the run prints only the sheets' full paths — open those images.
- Refer to tiles by the label under them (`485 0:08.08 [op02]`): that time and cue id are what the user pastes from the
  player, so a fix can be named exactly.
- A tile is 480p: judge composition, timing, overlaps and flashes from it; check small type in a 1080p MP4 or the browser.

## 5. Resume, stale chunks, fonts, footage
- Work goes to a temp folder per project + options. After Ctrl+C (or `kill`) the same command skips finished chunks /
  sheets; if the project's files changed in between (index.html, css, js, assets …), the old ones are dropped.
- Font check (default on): the DOM's visible text is asked which font files drew it (every 5 s of video in MP4 mode, every
  12th tile on a sheet) and every canvas `fillText`/`strokeText` is recorded with its font; a system font is reported as a
  warning under the chunk / sheet. `--no-font-check` turns it off.
- Footage (js/media-src.js) is filmed from frames cut beforehand: `node <skill>/scripts/stills.mjs <dir> --out
  media/render-stills --fps 60 --scale <s>` with s = 1 (1080p), 2 (4K), 0.6667 (720p) or 0.4444 (480p and sheets).
  burnmp4.py stops and prints the command when they are missing.

## 6. What it needs
Python 3 and ffmpeg (MP4 mode only; Mac: `brew install ffmpeg`). On the first run it makes its own virtual environment in
`~/.cache/burnmp4-venv` (Playwright + Chromium inside it) and runs itself from there; nothing goes into the system Python
or the project. `--no-venv` uses the current Python (Playwright must be installed there).
