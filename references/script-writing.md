# Writing the narration yourself (source material → script)

Read this when the user hands you **material** rather than a finished script: an article, notes, a spec
sheet, a topic, "turn this into a video". In that case you plan and write the narration. When the user
gives you a finished script, keep their words and follow fish-audio.md §2 instead.

These principles hold for any kind of piece: product launch, news brief, tutorial, explainer, story,
promo. They come from real review sessions, where every one of them was a correction the user had to
make.

## Contents
1. Plan before writing
2. Interpret, don't recite
3. Explain for the newcomer
4. No filler, but keep the bridges
5. Sentences that are finished and speakable
5b. Narration is speech, not writing (~니다 75 % · ~요 25 % · filler words)
6. Accuracy and attribution
7. Openings and sign-offs
8. Revising with the user

---

## 1. Plan before writing

- **Audience.** Who watches, and what do they already know? Write for the least-informed viewer you
  still want to keep.
- **Message.** State in one sentence what the viewer should remember.
- **Spine.** Choose a shape: hook → context → 3–6 sections → the one caveat or twist → a one-sentence
  wrap-up → sign-off. A short table of contents after the hook helps longer pieces (2 min+). Keep it to
  a single spoken line.
- **Length.** Roughly 5–7 Korean syllables per second at speed 1.0. A 4-minute piece is about 50 cues.

## 2. Interpret, don't recite

The screen shows the data and the voice says what it means. Reading figures aloud ("55.5% 대 57.8%,
1844 대 1846…") is the most common failure.

| instead of reading… | say what it means |
|---|---|
| a score or percentage | a relatable frame: "열 번에 한 번 → 열 번 중 일곱 번", "사실상 동점", "한 끗 차이" |
| a price table | the consequence: "같은 예산으로 두 배를 돌릴 수 있다" |
| a spec value | what it lets you do: "프로젝트 코드를 통째로 넣을 수 있다" |
| two numbers side by side | the verdict and why it matters for the viewer |

- **Keep at most one headline number per beat**, and only when it is the punch ("7배", "−30%").
- **Pair every data visual with a one-line takeaway on screen** (an insight chip, a caption bar) so the
  interpretation is visible as well as spoken.
- Illustrative visuals, such as a bar shortened to show "fewer tokens", must never be labelled as data.

## 3. Explain for the newcomer

Wherever the source is jargon-heavy (API parameters, medical terms, legal clauses, finance), use this
order per item:

1. **Who it concerns.** "여기서부터는 API로 직접 호출하는 개발자에게 해당합니다."
2. **What it is, in plain words.** "모델이 답하기 전에 속으로 추론하는 과정".
3. **What changed and what to do.**

On screen, show the term (code, name) next to a plain-language label and a definition panel. In the
narration, say the plain meaning; read out the raw identifier only when the viewer must type it.

## 4. No filler, but keep the bridges

(This is about empty *sentences*. Spoken filler *words* — 자, 사실, 그러니까 — are wanted: §5b.)

- **Cut meta lines that announce instead of deliver:** "~를 풀어 보겠습니다", "지금부터 살펴보겠습니다"
  when they add nothing. The user will ask "굳이 해야 해?".
- **Section changes still need a verbal bridge.** Without one, a list of chapters followed directly by
  "1M 토큰…" feels like a jump. Fold the bridge into the first content sentence ("먼저, 사양부터 보면,
  …") rather than giving it a sentence of its own.
- One idea per cue. If a cue grows past about 7 seconds, split it at a clause boundary.

## 5. Sentences that are finished and speakable

- **End with a predicate.** "…절반의 단가로." is a fragment in speech. Write "…절반의 단가로 쓸 수 있는
  모델입니다."
- **Avoid verbless noun lists.** "코딩, 실무, 컴퓨터 조작까지." gets garbled by TTS. Write "코딩과 실무,
  그리고 컴퓨터 조작까지, …".
- **Prefer the natural spoken register** of the channel (§5b: ~니다 75 % · ~요 25 %, filler words). Keep sentence
  rhythm varied: short punches between longer explanations.
- **Pronunciation and pauses** belong in `say`, not `text`. See fish-audio.md §3 for the Korean rules:
  names with versions, decimals, commas after connectives, and homophone traps.

## 5b. Narration is speech, not writing

The narration is heard once, at the speaker's pace — it is talk, not an essay read aloud. Write it the way the creator
would say it to the camera. This is the user's rule for every narration you write or adapt (with a finished script
from the user, keep their words; if its endings are far off, say so and offer to adapt it).

**Sentence endings — about 75 % 합쇼체, 25 % 해요체** (counted per sentence end, across the whole script):
- **~니다** (습니다 · 입니다 · 합니다 · 됩니다 · ~습니까?): facts, claims, results, what the screen shows, the key lines.
- **~요** (~요 · ~죠 · ~거든요 · ~네요 · ~잖아요 · ~까요?): asides, reactions, questions to the viewer, a personal
  remark, a turn to the next thing.
- Mix them: no long run of one register (not five ~니다 in a row with nothing softer; never a ~요 block that turns the
  video chatty). A ~요 line often follows a ~니다 fact as its reaction.

```
중국 숏드라마 시장은 작년에만 20조 원 규모로 추정됩니다.            ← 니다: the fact
올해 새로 나온 작품의 95% 이상이 AI로 만들어졌습니다.               ← 니다
그러니까, 만드는 비용이 확 내려간 거죠.                            ← 요(죠): the reaction, with a filler
자, 그럼 저도 직접 한 편 만들어 보겠습니다.                         ← 니다, opened with a filler
```

**Filler words, placed where a person would say them** — about one every 2–4 sentences:
- discourse markers: 자, · 그럼 · 그런데 / 근데 · 사실 · 그러니까 · 이제 · 아, · 한번 · 좀 · 여기서 · 보시면 · 그래서 · 뭐
- where: at the start of a new beat ("자, 결과를 볼까요?"), before a reveal ("사실, …"), when turning to the screen
  ("여기 보시면"), when summing up ("그러니까, …").
- where not: inside numbers, prices and dates, in a sponsor's required sentence, around a product name, in a line the
  user dictated. Don't repeat the same marker in consecutive lines.
- 자/사실/그러니까 are words: they go in `text` and `say`. Pure hesitation sounds (음…, 어,) go in `say` only, and
  only a few per video.

**Write for the ear**
- Short clauses, the predicate early; split a long written sentence into two spoken ones.
- Repeat the key noun instead of a pronoun or "이는", "해당"; no written connectives (또한, 이에, 따라서, 한편).
- Round numbers the way people say them ("스무 배 가까이"); the exact value is on screen.
- Speak to the viewer ("여러분", a question they'd ask) now and then — not every line.
- Read every line aloud in your head at speaking pace; if it sounds like a report, rewrite it.

`check.mjs` reports the ending ratio and how many lines carry a filler word for Korean narration.

## 6. Accuracy and attribution

- **Verify claims** against primary sources (the vendor's announcement, the benchmark's own page) and
  cross-check numbers from secondary write-ups. When the user's material and a source disagree, say so.
- **Attribute** vendor claims on screen ("Anthropic 발표 기준") and independent results ("Artificial
  Analysis 측정").
- **Softening in interpretation is fine; inventing is not.** "스무 배 가까이" for 18.5× is fine;
  "완전히 끌 수 없다" when the docs say there is a new "off" setting is not.
- **Research can add value.** You may add facts from research, such as extra highlights, but list what
  you added in the hand-off.
- **Your own words, always.** Facts come from sources; sentences don't. Never copy or lightly reword text from
  articles, websites or encyclopedias — write the narration and on-screen copy yourself (SKILL.md →
  Originality). A quote only when the user wants it, short and attributed.

## 7. Openings and sign-offs

- **Open on the news or the hook,** not on "안녕하세요, 오늘은…". The exception is a creator whose fixed
  intro the user supplies.
- **Many creators have a fixed sign-off:** a recap line, a subscribe/like/notification call, the channel
  name, a thank-you. If the user gives one, use it verbatim (fix only obvious spelling) and build a
  channel end card from their logo asset. Don't invent a question-to-the-audience ending when a sign-off
  is expected. If the channel is unknown, ask once, or end on a resolved title frame.

## 8. Revising with the user

- **Dictated wording goes in as dictated,** apart from obvious spelling fixes, which you mention.
- **Generalise a correction.** When the user fixes one line (a missing pause, a misread term, a fragment
  ending), search every cue for the same pattern and fix them all, or list the ones you left. The user
  should not have to find the same problem five times.
- **Re-check a changed script for new gaps.** Deleting a line can break a transition (§4). Rewording
  can move a `when()` anchor phrase, so update the anchors in `scenes.js`. `smoke.mjs` warns "phrase not
  found".

## 9. Lessons from the user's review rounds

- **No absolute claims about causes.** "이야기만 좋으면 다 성공한다" was rejected: "세상이 그런게 아니잖아. 아무리 품질이
  좋다고 다 유명해지고 성공하지 않는 것처럼." Say what made something *possible* or *worth trying* ("이제는 누구나 한번
  해 볼 만해진 거죠"), not what guarantees success.
- **Plain words over clever ones.** "승부가 이야기야?" — a metaphor the viewer has to decode is a bad line. Say it the
  way the user would say it to a friend; when a line is flagged as unnatural, rewrite it simply, then look for the same
  pattern elsewhere.
- **Every line must stand on its own.** A remark that only makes sense to someone who saw the chat ("시험이었다 쳐도…")
  confuses viewers: cut it or give it its context.
- **Don't overstate what a tool does.** A definition the user questioned ("영상 편집에 대한 정의로 적절해?") was
  rewritten to what the interface actually does ("다 만든 영상을 올려서, 배경이나 인물 같은 요소 하나를 말로 바꾸는 모드").
- **Required sentences may span two cues** and still count; keep their wording close to the brief.
- **Lines the user dictates are used as given** ("…정도로 담백하게 말해"); spoken forms go in `say` only.
- **Sponsored narration**: references/sponsored.md (no "can't" lines, prices only as seen on the button with
  "촬영 시점 기준 · 언제든 바뀔 수 있음", no period-bound wording).
- **Closing**: the creator's sign-off, then at most one light line that returns to the story's premise
  ("…후드티 입고 온 것도 좀 그렇긴 하네요. 여러분들은 어떻게 생각하시는지 댓글로 남겨 주세요").
