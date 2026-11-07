# Writing the narration yourself (source material → script)

Read this when the user hands you **material** rather than a finished script: a topic of a sentence or two, an
article, notes, a spec sheet, a planning doc (기획서), "turn this into a video". In that case you research, plan and
write the narration (§0 first). When the user gives you a finished script, use it **exactly as given**. Don't reword
it, and don't offer rewrites, even where a line would be easier to hear. Only `say` gets spoken forms (fish-audio.md §2).

**The first rule: the listener understands it the first time they hear it.** A script is speech, not writing. It is
heard once, in order, at the speaker's pace (the voice is never sped up or slowed down), and nobody can go back and
read it again. Every rule below serves that. None of them trades accuracy for convenience: the exact name, the exact
term with its explanation, the real number.

These principles hold for any kind of piece: product launch, news brief, tutorial, explainer, story,
promo. They come from real review sessions, where every one of them was a correction the user had to
make.

## Contents
0. From a topic or a planning doc: research and the plan
1. Plan before writing
2. Interpret, don't recite
3. Technical terms: say the term, then what it means
3b. Names: one thing, one exact name
4. No empty sentences, but keep the bridges
5. Sentences built for the ear
5b. Spoken, not written Korean (endings, words, filler words by their job, words the user never says, no AI-style phrasing)
6. Accuracy over convenience, and attribution
7. Openings and sign-offs
8. Revising with the user

---

## 0. From a topic or a planning doc: research and the plan

A sentence or two is enough to start: "블랙홀은 왜 검을까 2분 영상". The user wants the finished video, not a
questionnaire. Research, plan, write, then build and verify it all (SKILL.md steps 5–7) without stopping. The one step
that waits is recording their voice. They review the finished video and decide.

**Research — search, read, cross-check**
- Use the web search and page-reading tools the environment gives you (WebSearch / WebFetch or their equivalents). Start
  broad (what the topic is, what's new, what people get wrong), then go to the primary sources for every fact the video
  states. Primary sources include an institution's or a vendor's own page, a paper, official statistics, or the
  standard itself.
- Check every number or claim that the video stands on against a second independent source. Note the date for anything
  that changes (prices, rankings, records, versions): "2026년 11월 기준".
- When sources disagree, say so in the notes. Use the more authoritative one, or present the range.
- No search tools at all: say so in the hand-off, keep to what you are certain of, and mark those facts "not checked
  online" in `research.md`.
- Facts only. Write every sentence yourself; never copy or lightly reword a source (SKILL.md → Originality).

**`research.md` (in the project folder)**

```markdown
# 조사 노트 — <title>
조사일: 2026-11-07 · 질문: <what the video answers>

## 영상에 쓰는 사실
| # | 사실 (내 말로) | 출처 (기관 · 제목 · URL · 날짜) | 교차 확인 | 쓰는 큐 |
|---|---|---|---|---|

## 주제에 없던 내용으로 덧붙인 것   ← list these in the hand-off
## 명칭 (영상 전체에서 이 이름 하나로)
| 대상 | 공식 표기 (화면 `text`) | 읽는 법 (`say`) | 출처 |
|---|---|---|---|

## 출처끼리 다른 점 · 불확실한 점
## 조사했지만 뺀 것과 이유
```

**The plan (top of `storyboard.md`, before the beat table)**
- **Audience** and what they already know. **Message**: one sentence the viewer should remember.
- **Angle and hook**: why this topic is worth the viewer's next minute. Open on it.
- **Length and aspect.** Use what the user said. When nobody said, aim for about 2 minutes in 16:9 (≈ 25–30 cues) and
  30–60 s in 9:16.
- **Spine**: the sections in order with their cue ranges (§1). Decide the visual concept that will carry the piece
  (SKILL.md step 5) here too.

**A planning doc (기획서)** is the user's brief, not raw material. Read it into a requirement table at the top of
`storyboard.md`. Each row is an item, its source wording, where it is met (cue id / scene), and its status.
- **Kept as given:** lines it dictates (verbatim; spoken forms only in `say`), the audience, the length, must-show
  items, scene directions and the order of scenes, and things it forbids.
- **Yours to decide:** whatever it leaves open. Research and plan it as for a topic.
- If an item can't be met (a fact it states turns out to be wrong, a scene that can't be drawn originally), don't stop.
  Make the closest version, and name the item and what you did in the hand-off.

---

## 1. Plan before writing

- **Audience.** Who watches, and what do they already know? Write for the least-informed viewer you
  still want to keep.
- **Message.** State in one sentence what the viewer should remember.
- **Spine.** Choose a shape: hook → context → 3–6 sections → the one caveat or twist → a one-sentence
  wrap-up → sign-off. A short table of contents after the hook helps longer pieces (2 min+). Keep it to
  a single spoken line, and never show it as an agenda slide or list: let the visual idea preview the stops.
- **Length.** Roughly 5–7 Korean syllables per second. A 4-minute piece is about 50 cues.

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
- **Pair every data visual with a one-line takeaway on screen**, set as type on the stage (never in a box), so the
  interpretation is visible as well as spoken.
- Illustrative visuals, such as a bar shortened to show "fewer tokens", must never be labelled as data.

## 3. Technical terms: say the term, then what it means

Use the exact term. Never swap it for a vague paraphrase because that is easier, and **always explain what it means**
in plain words the first time it is heard.
- **Who needs it.** Judge by the least-informed viewer you still want to keep (§1). When unsure, explain.
- **In speech, per term:** say the term, then its meaning in one plain sentence, then why it matters here. Example:
  "컨텍스트 윈도라는 게 있는데요, 모델이 한 번에 읽고 기억할 수 있는 글의 양입니다. 이게 클수록 …".
- **A jargon-heavy passage** (API parameters, medical terms, legal clauses, finance) also says who it concerns first
  ("여기서부터는 API로 직접 호출하는 개발자에게 해당합니다"), then what changed and what to do.
- **The explanation must itself be correct.** Simpler must never become wrong. An analogy helps only beside the real
  explanation, and it is said as an analogy.
- **A term that comes back much later** (another chapter, a long video) gets a reminder in a few words.
- **On screen:** the term in its exact spelling, set as type with its plain meaning beside or under it. Never put it
  in a definition box or panel (SKILL.md → No slides, no boxes).

## 3b. Names: one thing, one exact name

- **The exact official name.** This covers companies, products, models, features, people and titles, each spelled
  and versioned the way its owner writes it. Check every name in a primary source and put it in `research.md`'s name
  table (§0). Feature and menu names are said exactly as the interface shows them.
- **One thing, one name, the whole way through.** A listener hears "Claude Opus 5.5", "오퍼스", "이 모델" and
  "새 모델" as four different things. Repeat the exact name rather than a convenient shortening. Shorten only where
  the short form is itself official and unambiguous.
- **Say what it is when the name is first heard:** "앤트로픽이 만든 AI 모델, 클로드 오퍼스 오 점 오".
- **Keep company, product and model apart:** OpenAI ≠ ChatGPT ≠ GPT-5.
- **Names that sound alike need their roles.** Don't let them sit side by side bare: say "이전 버전인 클링 삼 점 영"
  and "새 버전인 클링 사 점 영".
- **Never coin a term and present it as established.** "이른바 ○○ 효과" that doesn't exist misleads. A label you make
  up for the video is said as your own.
- **Screen and voice name the same thing.** `text` carries the official spelling, and `say` carries how the name is
  really pronounced (fish-audio.md §3).
- Other people's brands and real people: sponsored.md §4 and SKILL.md → Originality.

## 4. No empty sentences, but keep the bridges

(This is about empty *sentences*. Filler *words* that do a job are a different thing: §5b.)

- **Cut meta lines that announce instead of deliver:** "~를 풀어 보겠습니다", "지금부터 살펴보겠습니다"
  when they add nothing. The user will ask "굳이 해야 해?".
- **Section changes still need a verbal bridge.** Without one, a list of chapters followed directly by
  "1M 토큰…" feels like a jump. Fold the bridge into the first content sentence ("먼저, 사양부터 보면,
  …") rather than giving it a sentence of its own.
- One idea per cue. If a cue grows past about 7 seconds, split it at a clause boundary.

## 5. Sentences built for the ear

- **Give the map first.** Put the conclusion before the reasons. Say how many are coming ("이유는 세 가지입니다.
  첫째, …"). Go from what the viewer knows to what is new. Close a section with a one-line recap: in writing that
  would be repetition, but in speech it brings back whoever drifted.
- **One idea per sentence.** Keep the subject close to its predicate.
  - No stacked modifiers before a noun. Split "어제 발표된 새 모델이 한 번에 처리할 수 있는 최대 분량은 …" into two
    sentences.
  - No noun chains ("~의 ~에 대한 ~의 증가"): say it with verbs.
  - No double negatives.
- **Numbers.** One per sentence. Never two similar numbers side by side. Say the unit clearly. The exact figure goes on
  screen (§2).
- **Screen and voice don't compete.** The screen shows what is being said at that moment. Never make the eye read one
  thing while the ear hears another.
- **The eyes-closed test.** Would the line make sense heard alone, with no picture?

- **End with a predicate.** "…절반의 단가로." is a fragment in speech. Write "…절반의 단가로 쓸 수 있는
  모델입니다."
- **Avoid verbless noun lists.** "코딩, 실무, 컴퓨터 조작까지." gets garbled by TTS. Write "코딩과 실무,
  그리고 컴퓨터 조작까지, …".
- **Prefer the natural spoken register** of the channel (§5b: ~니다 75 % · ~요 25 %, filler words by their job). Keep
  sentence rhythm varied: short punches between longer explanations.
- **Pronunciation and pauses** belong in `say`, not `text`. See fish-audio.md §3 for the Korean rules:
  names with versions, decimals, commas after connectives, and homophone traps.

## 5b. Spoken, not written Korean

The narration is heard once, at the speaker's pace. It is talk, not an essay read aloud: write it the way the creator
would say it to the camera. This is the user's rule for every narration you write. A finished script from the user is
used exactly as given.

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

**Spoken words and endings, not written ones.** Written Korean has its own words and grammar that nobody uses when
talking. Each of these makes a line sound read off a page:
- formal Sino-Korean words where an everyday word exists;
- connectives and particles that only appear on paper;
- the plain written endings (해라체);
- report endings that keep the speaker at a distance from what they say;
- clause endings that chain thoughts the way an essay does;
- passives that hide who did it;
- the noun-ending fragments of a memo.

Say it the way the creator would say it out loud: the everyday word, a spoken connective or a new sentence, a ~니다 or
~요 ending, the active voice, and who did what.

**The measure is the word a person actually uses when they say it** — most often the native, everyday word. The
user's own case: "식사했습니다" vs "밥 먹었어요". Both mean the same, but "식사" is a formal category word that keeps
the listener at a distance and paints no picture, while "밥 먹었어요" is what people say and is understood at once.
The same holds for a whole sentence: "기능 개선으로 인해 처리 속도가 증대되었다" → "기능을 고쳐서 처리 속도가
빨라졌습니다". Here a paper connective, a formal word and a passive all give way to what a person would say.
Accuracy (§3, §3b, §6) is about names, terms and numbers. It is never a reason to pick the formal word over an
everyday one that is just as true.

- **What stays exact.** Technical terms and names are not "written words" to swap out (§3, §3b). Only the words around
  them become spoken.
- **Spoken order.** Put the topic first ("이 모델, 가격이 절반입니다"), or say a sentence in two breaths
  ("놀라운 건 여기부터인데요, 가격이 절반이에요").
- **A speaker and a listener.**
  - The creator speaks from experience in the first person ("제가 직접 해 봤는데요").
  - Turn to the viewer now and then ("여러분", a question they'd ask).
  - Keep the creator's own voice. Never sound like a news anchor, a report or a textbook.
- **Nothing unreadable in `say`.** No brackets, slashes, arrows, tildes or symbols (%, ×, ~, →). Spell them as
  spoken: "3~5개" → "세 개에서 다섯 개", "A/B" → "A와 B". A bracketed aside becomes its own sentence or goes on screen.
- **Spoken is not sloppy.** Sentences stay complete, grammatical and exact. No slang, buzzwords, exaggeration or 반말
  unless the channel uses them.

**Filler words — only where they do a job.** Korean discourse markers carry meaning. One in the wrong place changes the
logic, and one added for its own sake is noise and time (the voice is never sped up). There is no quota.

| word | only when |
|---|---|
| 자, | a new beat or scene starts ("자, 결과를 볼까요?") |
| 그럼 / 그래서 | what follows is the consequence of what came before |
| 근데 / 그런데 | what follows contrasts with what came before |
| 사실 | a truth that runs against what the viewer expects |
| 그러니까 | a summary or a restatement follows |
| 여기 보시면 | the screen shows the thing being pointed at |
| 이제 | the next step begins |

- **Not:** pure hesitation sounds (음…, 어,), or 뭐 and 좀 used as fillers.
- **Never inside** numbers, prices and dates, a sponsor's required sentence, a product name, or a line the user
  dictated.
- Don't repeat the same marker in consecutive lines.
- They are words: they go in both `text` and `say`.
- The user's own speech habits come first. Never use a word the user doesn't say (below).

**Words the user never says.** Never write these in a narration you write, as a filler or anywhere else:
- **솔직히**, and the same phrase in its other forms (솔직하게 말하면, 솔직히 말씀드리면).

Say the thing itself instead: "솔직히 좀 놀랐습니다" → "이건 좀 놀랐습니다". A line the user wrote themselves keeps
their wording. You check this yourself: read every line before hand-off. When the user names another expression they
don't use, add it here.

**No AI-style phrasing (absolute).** Some lines sound polished but don't land. The listener has to stop and work out
what they mean, and by then the next line is already playing. A model writing Korean produces them out of habit:
- it carries an English expression over word for word, so the Korean is grammatical but no Korean speaker would say it;
- it compresses a point into a maxim or a slogan that sounds wise and states nothing you could check;
- it makes an abstraction act like a person;
- it reaches for a metaphor the listener has to decode, or for a big vague noun in place of the thing itself;
- it inflates, or it hedges, instead of stating;
- it picks a phrase for its rhythm rather than its content.

What these share: the line names no concrete fact. The fix is always the same. Say literally who did what, what
changed, and by how much. This is banned in every narration line and in every piece of on-screen copy (titles,
takeaways, labels).

The real case this rule comes from: "장식은 성과를 사지 못한다", a word-for-word rendering of "Decoration doesn't buy
performance". Said plainly, it is "효과를 많이 넣는다고 영상 반응이 좋아지지 않았습니다". It shows the pattern; it is
not a list to match against.

**The test:** could the listener repeat the line in their own words right after hearing it once? Would a person say it
to a friend? If not, rewrite it into concrete, literal words: who, what, how much. This is not a word list to match;
it is a judgment you make on every line.

**Write for the ear**
- Short clauses, the predicate early; split a long written sentence into two spoken ones.
- Repeat the key noun instead of a pronoun; no connectives that only appear on paper.
- Round a number only when you say it is approximate ("약", "가까이": "스무 배 가까이" for 18.5×) and the exact value
  is on screen. Never round in a way that changes the meaning.
- Speak to the viewer ("여러분", a question they'd ask) now and then — not every line.
- Read every line aloud in your head at speaking pace; if it sounds like a report, rewrite it.

You check all of this yourself. Read every line of a narration you wrote before the hand-off; no script judges wording
for you.

## 6. Accuracy over convenience, and attribution

- **Accuracy over convenience.** Use the exact name (§3b), the exact term with its explanation (§3), and the real
  number with its unit. Never use a looser word because it is easier to say. Analogies sit beside the real
  explanation, not in its place.
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
