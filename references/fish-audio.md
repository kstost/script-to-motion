# Narration with Fish Audio

How to turn the user's script into `script.json`, how `tts.mjs` talks to Fish Audio, and what to do
when a take is wrong.

## Contents
1. script.json
2. Splitting the script into cues
3. Writing `say` (pronunciation, tags, pauses)
4. What tts.mjs does
5. Reviewing takes you can't hear
6. API facts & troubleshooting

---

## 1. script.json

```json
{
  "title": "웹이 곧 영상이다",
  "lang": "ko",
  "voice": "<the user's Fish Audio voice model id>",
  "model": "drama-3",
  "speed": 1.0,
  "temperature": 0.7,
  "leadIn": 0.6,
  "gap": 0.45,
  "tail": 1.5,
  "cues": [
    { "id": "c01", "say": "[calm] 영상은 더 이상 파일이 아닙니다.", "text": "영상은 더 이상 파일이 아닙니다." },
    { "id": "c02", "say": "이천이십육 년, 브라우저가 렌더러가 됩니다.", "text": "2026년, 브라우저가 렌더러가 됩니다.", "gapAfter": 0.6 }
  ]
}
```

| field | meaning |
|---|---|
| `narration` | `false` = a video without narration (no Fish Audio call; silent audio; cues timed by estimated reading time). Use it when the user didn't provide their Fish Audio API key and voice id. Default: narration on. |
| `voice` | Fish Audio voice model id (`reference_id`) — **the user's, required**. The user keeps it as `FISH_VOICE` in the skill's `.env` (git-ignored) with `FISH_API_KEY`; copy the id into `script.json`. Never choose or guess a voice; `tts.mjs` only calls the API with a voice id and the user's API key. |
| `model` | **`drama-3`** — the user's model, the default: directed in plain language (below). Docs: https://docs.fish.audio/features/text-to-speech and https://docs.fish.audio/features/text-to-speech/drama-3. Sent as the `model` request header; a missing or misspelt header does **not** fail — it silently falls back to `s2.1-pro`, so keep the exact name. Other models (`s2.1-pro`, `s2-pro`) only when the user asks. |
| `speed` | 0.5–2.0 speaking rate (`prosody.speed`). 1.0 default; 0.95 for calm/emotional, 1.05–1.1 for energetic. Per-cue `speed` overrides. Its effect on a take is not proportional (a faster setting sometimes gave a longer take) — to make a line fit a slot, reword it; never use `speed` to fit a dub (references/sound.md §6). |
| `temperature` | 0–1 expressiveness/variation. 0.7 default; lower (0.5) if takes sound inconsistent across cues. |
| `leadIn` | seconds of silence before the first cue (the opening visual gets a moment). |
| `gap` | default silence between cues. |
| `tail` | seconds after the last cue before the video ends (final frame hold). |
| cue `id` | alphanumeric, starts with a letter: `c01`, `c02`… (they become timeline labels). |
| cue `say` | exactly what the TTS reads (may contain tags / phonetic spellings). |
| cue `text` | what a viewer reads: captions, `when()` phrase lookup. Defaults to `say` without tags. |
| cue `gapAfter` | silence after this cue (overrides `gap`). |
| cue `captions` | optional list of one-line caption segments for this cue, e.g. `["아무 말 없이 지나가면", "조금 전까지 인사하던 사람이", "갑자기 쌀쌀맞아진 것 같다."]`. Without it the player splits `text` automatically. |

## 2. Splitting the script into cues

- **Keep the user's words.** The script is theirs: don't paraphrase, shorten, reorder or "improve" it.
  You split it and adjust only *how it's pronounced* in `say`. If something seems wrong (typo, a
  sentence that obviously doesn't belong), keep it and mention it in your summary.
- One cue ≈ one sentence ≈ 2–7 s. Split sentences longer than ~7 s at a natural clause boundary
  (after `-고,` `-며,` `-지만,` `, ` etc.), so visuals can change with the thought.
- Merge very short fragments (< 1.5 s) into the neighbour unless they are a deliberate punch line.
- Headings or labels in the script that aren't meant to be spoken (e.g. "[장면 1]", "(자막: …)",
  "#인트로") are directions for you, not narration — use them in the storyboard, leave them out of `say`.
- `gapAfter`: 0.3–0.45 inside a thought, 0.5–0.65 at a scene/section change or after a question. Never 0.7 s or more
  in silence: that is dead air (references/sound.md §1) — when a change needs a longer beat, fill it with sound (the next
  clip, a transition sound) or start the next line under the transition.

## 3. Writing `say`

Fish's text normalisation is tuned for English and Chinese, so spell out anything a Korean reader
would read differently from how a model might:

| display (`text`) | `say` |
|---|---|
| 2026년 | 이천이십육 년 |
| 3.5배 · 70.6% | 삼쩜오 배 · 칠십쩜육 퍼센트 (decimal as one word with `쩜`; spaced "삼 점 오" is read choppily) |
| Sonnet 5.5 · iPhone 17 · GPT-6 (name + version) | 소넷오쩜오 · 아이폰십칠 — **no space** between name and number, or the voice pauses after the name. Decide once whether a version is read in Korean or English ("소넷파이브") and keep it consistent |
| 1,280,000명 | 백이십팔만 명 |
| 15% | 십오 퍼센트 |
| 10~20분 | 십 분에서 이십 분 |
| 3시 30분 | 세 시 삼십 분 |
| 1위 / 2개 / 3명 | 일 위 / 두 개 / 세 명 (native vs Sino-Korean counters!) |
| A/B 테스트 | 에이비 테스트 |
| AI, API, UX | 에이아이, 에이피아이, 유엑스 (common ones usually work as-is; spell out if a take comes back wrong) |
| → , · , / | 그리고, 쉼표, 또는 — or restructure the sentence |
| URLs, emails | say them the way a person would ("fish 점 audio"), or leave them on screen only |

Spoken register (script-writing.md §5b): a filler word at the start of a line takes a comma in `say` (`자, 결과를
볼게요` / `사실, …`) so the voice breathes after it; hesitation sounds (`음…`) go in `say` only.

Punctuation shapes delivery: commas are short pauses, periods longer, `?` rises. Avoid ellipses and
exclamation marks unless the script has them.

**Pauses and grouping (Korean).** The voice groups words by spacing and punctuation, and a wrong group
changes the meaning. Put commas in `say` only; `text` keeps normal punctuation for captions. Each rule
below came from a real misreading:

| problem | `say` fix |
|---|---|
| a sentence-initial connective runs into the next word ("대신 같은 일을" heard as one phrase) | comma after it: `먼저,` `대신,` `반대로,` `다만,` `특히,` `결국,` |
| a long modifier clause runs into a name or term ("…해내는지 보는 터미널 벤치에서") | comma before the name: `…해내는지 보는, 터미널 벤치에서,` |
| a verbless list of short nouns ("코딩, 실무, 컴퓨터 조작까지.") gets garbled or skipped | rewrite as a clause: `코딩과 실무, 그리고 컴퓨터 조작까지, …` |
| homophones: "2점" is read `이 점`, heard as "this point"; `이 위`, `일 등` similar | rephrase ("사실상 동점", "두 번째 자리") or keep the number on screen only |
| a line ends on a particle ("…단가로.") and sounds cut off | finish the sentence (script-writing.md §5) |

When the user reports one of these on one line, **search all cues for the same pattern** and fix them
together, then list which lines you changed so they can listen.

**Expression tags** (S2 models; free-form natural language in square brackets, not spoken):
- emotion: `[calm]` `[confident]` `[warm]` `[excited]` `[serious]` `[sad]` `[hopeful]` `[surprised]` …
- tone: `[soft]` `[whispering]` `[emphasis]` `[hurried]` `[shouting]`
- effects: `[laughing]` `[sighing]` `[chuckling]`
- pauses: `[break]` (short), `[long-break]`

Put a tag at the start of the sentence it colours; combine at most 2–3. Use them where the script's
mood actually shifts (the hook, the turn, the closing line), not on every cue — over-tagging sounds
theatrical. A calm, confident explainer usually needs almost none.

## 4. What tts.mjs does

```
node <skill>/scripts/tts.mjs <project> [--only c03,c07] [--force] [--placeholder]
```

1. Hashes each cue's (model, voice, say, speed, temperature) → `.tts-cache/<hash>.pcm`. Unchanged
   cues are reused; editing one cue only re-synthesises that cue. `--only` forces new takes for the
   listed cues (the voice samples randomly, so a new take differs); `--force` redoes all.
2. Calls `POST https://api.fish.audio/v1/tts` (header `model`, body `reference_id`, `format: "pcm"`,
   44.1 kHz), 3 requests in parallel, retrying 429/5xx.
3. Trims leading/trailing silence so `cue.start` is the moment the voice begins.
4. Lays cues out: `start = leadIn`, then `end + gapAfter` for each next cue.
5. Writes `audio/cues/<id>.wav`, `audio/narration.wav` (t=0 aligned) and `narration.mp3` (ffmpeg), and
   `js/cues.js`.
6. Flags takes with unusual durations (see §5) and prints the timeline.

`--placeholder` makes silent audio with estimated timing and marks the data `placeholder: true`;
tts.mjs and check.mjs warn about it. Use it only to build visuals while waiting for a key, and always
regenerate before delivering.

## 5. Reviewing takes you can't hear

You can't listen, and TTS occasionally mispronounces, skips or repeats words. **Never transcribe the
takes** — no Fish ASR (`/v1/asr`), no other speech-to-text service or model. It costs API credits,
and judging whether a take is right is the user's job; the audio is only ever sent to the TTS endpoint
that creates it.

What you can do:
- **Duration sanity** (local, automatic): `tts.mjs` flags takes much longer than expected (repetition,
  trailing noise) or much shorter (dropped words).
- **Prevent misreadings up front** with careful `say` spellings (§3) — this is where most problems are
  avoided.
- **Ask the user to listen.** In the hand-off, point to `audio/narration.mp3` and to the specific
  `audio/cues/<id>.wav` files worth checking: flagged durations, lines with expression tags, numbers,
  English terms, names.

When the user reports a bad line: if it's a misreading, respell `say` (phonetic Hangul, split the
sentence, add a comma) and re-run; if `say` is fine, take again with `--only <id>`.

## 6. API facts & troubleshooting

- Auth: `Authorization: Bearer <key>`. The script reads `FISH_API_KEY` (or `FISH_AUDIO_API_KEY`) and `FISH_VOICE` from
  the environment, else from a `.env` in the project folder or any parent folder, else from **the skill's own `.env`**,
  where the user keeps their keys (git-ignored). Never copy a key into the deliverable, a tracked file, output, a URL
  or memory. When the user gives a new key in chat and asks to keep it, replace the line in the skill's `.env` only.
  No key and voice id → the video is made without narration (SKILL.md step 4).
- `drama-3` and `s2.1-pro` support Korean and many other languages; output 16-bit mono (`format: "pcm"`).
- No word-level timestamps are returned — `sync.mjs` measures them from the takes instead (references/sound.md §2).
- 401 → key invalid. 402 → account out of credit (tell the user; don't retry). 429/503 → retried
  automatically; if it keeps failing, wait and re-run (cached cues are kept).
- A voice that sounds wrong for every cue → check `voice` in script.json.
- Uneven loudness between cues is normalised by the API (`prosody.normalize_loudness` default).

## 7. After the takes

- `sync.mjs <dir>` measures when each phrase is spoken in each take, so `cue(id).when()` hits the word
  (references/sound.md §2). Re-run after every new take.
- `silence.mjs <dir>` checks the whole mix for dead air ≥ 0.7 s (the user's rule).
- A dubbed track in another language uses the same voice and `dub.mjs` (references/sound.md §6).

## 8. Directing drama-3

drama-3 takes directions inside the text (none of them are spoken):
- **Delivery in plain words**, in brackets before the words it applies to — written like a brief to a voice actor, in
  Korean or English: `[호기심을 확 끄는 유튜버 오프닝, 자신 있게]`, `[barely holding it together, forcing a smile]`.
  Keep them sparse: the opening, a turn, a reveal, the sign-off — not every line.
- **Sounds and pauses where they happen**: `[짧은 웃음]`, `[small laugh]`, `[sigh]`, `[shaky breath]`, `[short pause]`.
- **Only some words**: paired tags `<emphasis>…</emphasis>`, `<whisper>`, `<soft>`, `<fast>`, `<slow>`, `<stress>`,
  `<forceful>` — e.g. `딱 <emphasis>두 배</emphasis>죠`.
- **Pronunciation**: phoneme tags `<|phoneme_start|>…<|phoneme_end|>` (English Arpabet, Chinese pinyin, Japanese
  romaji); for Korean, respell in Hangul instead (§3).
- **Another language for a phrase** (experimental): `<english>…</english>`; prefer writing the term as it is said.
- Directions go in `say` only; `text` stays clean for captions. `sync.mjs` and the captions ignore every tag.

## 9. Approval before recording

Narration is generated only after the user approves the lines (SKILL.md step 4): `tts.mjs <dir>` without `--approved`
records nothing new — new cues are silent placeholders — and `--only` / `--force` refuse to run without it. Show the
user the cue list (id + `text`), wait for their OK, then `tts.mjs <dir> --approved`.
