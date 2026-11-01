# The YouTube package — title, thumbnail, description, pinned comment, chapters, subtitles, dub

The video is half the job. This file is how the upload text and files were made for the Kling video, and what the user
corrected along the way. Deliver it as one copy-ready file (`업로드/youtube.md`: every block in a code fence, in the
order it is pasted) next to the files it names.

## Contents
1. Title
2. Thumbnail
3. Description
4. Pinned comment
5. Chapters, subtitles, translations, dub
6. Upload checklist
7. Checking it against a brief

## 1. Title

- Write **at least five** candidates with different hooks, say which you'd pick and why, and let the user choose. The user
  often rewrites it; use their wording exactly from then on.
- Lead with what the viewer will see happen, or with the stakes the audience already cares about. For this audience
  **money is the hook**: "돈을 쓸어담는다는 AI 숏폼드라마, 저도 만들어봤습니다" beat every feature-led title.
- Promise only what the video delivers. A money hook is hearsay or a question ("~다는", "얼마 들까?"), never an income
  promise; no number in a title that can change (prices).
- Sponsored: the product name is not the first words (a common brief rule); it can come later ("| Kling 4.0").
- Give an English title for YouTube's title translation.

## 2. Thumbnail

"썸네일은 지금대로 하면 아무도 클릭하지 않을거야. 당연히 돈이 전면에 나와야해." — a correct but quiet thumbnail
(a plan card next to a result) got no clicks. The order of business:
1. **The hook, huge**: the stake as an object and a number — a heap of money, notes flying, "20조" in gold with a thick
   dark outline. Two or three words in total.
2. **A face or the result** that makes it real (the generated actor at the door), large enough to read on a phone.
3. **The proof**, small: the planned frame beside the generated one (what a sponsor's brief asks for), tucked into a corner.

- Don't repeat the title's words on the thumbnail — title tells, thumbnail shows.
- Make it in code like the video (`thumbnail/thumbnail.html`, the project's OFL fonts, ≤ 800 weight), render with
  `node <skill>/scripts/thumbnail.mjs thumbnail/thumbnail.html --out ../업로드/thumbnail.png` (1280×720).
- Draw money as generic notes (a ₩ mark in strokes, no banknote design): real currency designs are protected.
- No emoji, no third-party logos; the user's footage only via provenance.

## 3. Description

- **Tracking link on the first line** (briefs say "first lines"; on a phone only one or two lines show before "more").
  Then one hook sentence.
- A short, friendly intro talking to the viewer: what the product is, the 2–3 facts the brief requires, what this video
  does with it, a CTA ("콘티 한 장부터 그려 보고, … 직접 확인해 보세요").
- **Keywords woven into sentences, never a keyword line.** In Korean, give the Korean phrase with the exact keyword in
  parentheses: "AI 영상 편집(AI video editing)". Check every keyword exactly — case, spacing, no hyphen added
  ("30 second AI video", not "30-second"), and at least once not glued to a Korean particle ("Higgsfield에서" doesn't
  count as a clean match; "Kling 4.0 on Higgsfield 소개 페이지" does).
- The product page link if the brief names one, in addition to the tracking link (on its own line).
- Timestamps (chapters.mjs), question-style.
- **Nothing the brief doesn't ask for.** The user removed sources, cost notes, disclosures and hashtags from the
  description ("가이드에서 이야기하지 않는 불필요한 내용은 포함하지 말아. 타임스탬프는 유지해"). Disclosure is the
  platform's paid-promotion toggle (checklist).
- Limits: ≤ 5,000 characters; no `<` or `>` (YouTube rejects them).
- Another language goes into YouTube's **Languages → add translation → title & description**, not appended to the same
  box — each language then has its own chapters and its own first-line link.

## 4. Pinned comment

When a brief says "a pinned comment that repeats the same description text + link": copy the description's intro block
**verbatim** (from the link line through the product page), add the other language's intro if there is one, and end with
the brief's short CTA + link ("Direct your first 30-second scene! → <link>"). Long is fine (it folds after a few lines);
the first line must be the link.

## 5. Chapters, subtitles, translations, dub

| file | made by | notes |
|---|---|---|
| chapters in the description | `chapters.mjs <dir> [--lang en]` | ≥ 3, 0:00 first, each ≥ 10 s, questions with the product/feature name |
| `<name>.ko.srt`, `<name>.en.srt` | `subs.mjs <dir> --out ../업로드 --name <name>` | drama/dialogue lines via `subs.json` extra |
| `<name>.en.wav` dub track | `dub.mjs <dir> --lang en` | same length as the video; references/sound.md §6 |
| `thumbnail.png` | `thumbnail.mjs` | §2 |

The user makes the MP4 from the HTML project themselves; the package never includes or mentions a render.

## 6. Upload checklist (put it at the end of youtube.md)

- [ ] title (+ English title translation), thumbnail
- [ ] description pasted; link on line 1 replaced with the real tracking link if it was a placeholder
- [ ] Languages: English title & description translation; dub audio track if made; subtitles (SRT)
- [ ] English auto-dubbing on when the brief requires it (an uploaded dub track replaces it for that language)
- [ ] paid promotion toggle on (sponsored); "altered or synthetic content" = yes for AI-generated people/scenes
- [ ] pinned comment posted and pinned; chapters show on the progress bar
- [ ] length rule (e.g. 6 min+) and nothing confidential on screen (a brief marked personal-use only)
- [ ] submit the video link wherever the campaign asks

## 7. Checking it against a brief

When the user asks "가이드에 맞아?" answer **the scope they asked** (the description only, if that's what they said) as a
requirement-by-requirement table quoting the brief's wording, and say exactly what you changed. "100% 충족해?" deserves
a precise yes/no per item, including judgement calls (anchor text in Korean vs the brief's English wording) — not a
general reassurance. See references/sponsored.md for the brief itself.
