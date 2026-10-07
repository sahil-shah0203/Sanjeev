# QA: adaptive questions based on your deck

This experiment is enabled by `ENABLE_DECK_PRACTICE=true` on the worker and the **QA branch's Vercel Preview environment only**. It also requires the existing source-practice, adaptive-practice, and generation flags. Production web behavior stays on the previous policy. No migration is required. The shared worker supports both policies.

## Learner flow

Sign in, enable AI-generated questions before starting a timed session, and rate ordinary cards normally. After an original review is saved, background generation can request a question based on that card's current note, template, active cloze, answer, and rating. The original FSRS review is already committed. A preparing/ready indicator exposes the background work; `[Sanjeev AI]` console events describe requests, skips, and delivery without logging private deck text.

At most one generation opportunity is reserved per four original reviews, with six requests per session and a 30-job daily owner limit shared with grading. An activity waits for at least two more original reviews after its source review. Expected and accumulated activity time must fit a 20% session budget. Network latency, unsupported source text, verification failures, or exhausted budgets can produce fewer questions. Users can always skip. Explanations are not forcibly cut off mid-answer, but their elapsed time reduces later activity eligibility.

Again/Hard preferentially asks for a concise explanation or repair. Good rotates recall, multiple choice, explanation, and comparison. Easy can also request application **only of a condition or consequence explicitly present in the source**. Format and cognitive task are recorded separately. Weak responses influence later style selection; completing every style is not required.

## Scheduling and feedback

Original cards use FSRS. AI answers, model feedback, reports, disputes, and skips never modify those original schedules. AI exposure, assistance, performance, and time are recorded separately. Correct AI responses influence style selection, rather than creating an extra FSRS success after the same fact was just shown.

Multiple-choice grading uses the canonical source answer. Written responses can receive brief model feedback: what matched, one missing point, and a source-supported correction. Feedback is explicitly unverified and can be disputed. When generation or grading fails, continue normal review or self-check against the displayed source.

## Source constraints and limitations

- The generator receives immutable source references and the actual reviewed answer. Text beside images is eligible; the system does not interpret images. Image-only notes without useful text are skipped.
- The model may write distractors and alternate stems. The correct answer must exactly match the source target. Rejection explanations, rubrics, and feedback must be supported by the supplied source.
- Structured schema validation and a second model source-support check precede publication. Feedback has a separate support check. These checks can still miss errors and do not establish medical correctness.
- No invented clinical cases, external medical mechanisms, or treatment facts are permitted. Source decks can themselves be wrong. Prompt-like source text and unsupported source structures are rejected.
- Activities are visibly marked AI-generated/unverified, with source references and skip/report/dispute controls. Reporting quarantines the activity. Human review is not an entry requirement for this narrowly source-based QA mode; broader draft workflows retain their existing review gate.
- Each generation or written feedback job can use two model calls, within the configured spend ceiling. Fixture mode supports synthetic notes, not arbitrary imported decks.
- Signed-in, online access is required for generation and cloud feedback; ordinary review and previously saved local data remain usable offline.

## Media transitions

Study prepares and decodes local media before changing the displayed original card, keeps the previous question visible during preparation, and preloads the next card. A bounded cache reuses prepared URLs. Genuinely missing, unsafe, or undecodable assets still show a media-unavailable state.

## Focused verification and friend testing

Run type checking, lint, the deck-practice/source-practice/job/sync tests, and the production build. Tests use synthetic content and cover extraction, active clozes, immutable source validation, canonical MCQ keys, second-model rejection, unsupported feedback, budgets, idempotent attempts, reporting, and unchanged FSRS state.

The hosted Railway worker was also checked with a temporary synthetic account: real OpenAI generation published a validated explanation activity, and real written-answer grading returned source-supported feedback. The account and its records were removed afterward. This verifies the provider/worker path, not learning benefit or medical accuracy.

On QA, enable the toggle in a signed-in session and review at least eight text-backed cards. Check preparing/ready status, the flagged question and exact source references, skip, written feedback, and report/dispute. Repeat with image-backed cards and confirm no transient missing-media flash. Compare perceived usefulness and time against ordinary review; improved learning efficiency remains a hypothesis to evaluate.
