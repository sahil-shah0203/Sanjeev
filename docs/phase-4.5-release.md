# Phase 4.5 — Sanjeev beta

This iteration implements the [Phase 4.5 brief](phase-4.5-ui-and-study-mode.md). It does not claim Phase 5/6 completion, medical validation, or improved learning outcomes.

## Learner changes

- Sanjeev identity, book icon, warm beige surfaces with green accents, and a warm dark theme.
- Today holds deck/duration setup and the single optional AI switch. Starting from a deck retains that deck in Today’s setup. Import lives in Decks, with a prominent first-import action on an empty Today page.
- `/settings` contains study preferences and collapsed advanced scheduling. `/account` contains optional sign-in, automatic sync, guest migration, backup/restore, conflict export and collapsed destructive actions. Old `/settings#account` and auth-return links still redirect appropriately.
- `/help` explains importing, first review, FSRS ratings, shortcuts, optional AI, offline readiness and backups. It never blocks study.

## Exact AI scope

AI is off by default for each new session. A signed-in student can opt in for a timed session (5 minutes or longer). The toggle discloses the provider and selected-source processing. Ordinary study works offline and as a guest. Consent is stored with the session; it is independent of legacy provider consent and research enrollment. Turning AI off stops further requests/delivery in that session.

The worker asks the configured model to choose an explicit source unit or abstain. **The model cannot author the displayed medical text:** a deterministic compiler builds the exercise from the selected note and a validated recipe. Supported formats are source-text completion, recognition of exact original wording, source-visible comparison, and one-sentence restatement. Recognition alternatives are terms occurring elsewhere in the same note, not invented clinical distractors; this is a wording exercise, not a clinical best-answer question. Task and format are recorded separately.

Only primary text and, for basic cards, the answer field are sent. Extras, tags, unrelated notes and media are excluded. Primary text is limited to 1,200 characters; a basic answer is limited to 800. Nested/malformed clozes and sources without an explicit target abstain. A conservative lexical exclusion and model abstention reject clinical decision/case/dosing/management content. These filters are deliberately incomplete as medical classification; exact-source compilation is the stronger boundary. They do not validate the source, detect every patient identifier, or guarantee that a note is true. Never include patient information.

All exercises show “AI-generated · unverified” and exact source references. Free text is saved as uncertain and offers self-check annotations. Recognition is checked against its stored source-wording key. No model grading endpoint is called for this mode. Source-visible/previously reviewed exercises are recorded as contaminated practice, not independent mastery evidence. Original FSRS ratings remain separate.

One optional exercise can follow each ten original reviews. Extra practice is limited to 15% of the planned time, 20–30 seconds per exercise, one explanation/comparison per session, and at most three generation requests per session. Learning steps and large overdue queues take priority. Formats rotate across available source formats and previously generated items; a note with one explicit target may support only completion/restatement. The pilot does not force back-to-back questions on every card. Small decks/sessions with fewer than ten completed original reviews may never show an extra exercise.

Generation runs in the background. Failure, abstention, quotas or lack of a fitting activity leave the original review available. Display, attempt, report and interruption records persist locally and sync. A report quarantines the version for the owner and prevents new generation for that same source version pending review. A source edit invalidates the exercise. Restored backups quarantine generated content rather than treating restored metadata as trusted publication.

## Operations and compatibility

- New flag: `ENABLE_SOURCE_PRACTICE=true` on Vercel and Railway. Web also requires the existing adaptive/generation flags. Set the new flag to false to stop this pilot while keeping ordinary study available.
- Existing provider/model configuration, daily reservation ceiling, durable jobs, leases, RLS, origin checks and owner isolation are retained. No new database migration is required: the additive session and activity fields live in the existing versioned documents.
- `source_bounded` is separate from `human_approved`. Clients cannot mint either publication state through sync. The protected reviewer workflow remains at `/review-content`; it is removed from everyday navigation.
- Internal `recall-*` database names, bucket, package names, guest key, `.recall` backup format and cloud identifiers are retained for existing-data compatibility. The existing hosting URL is also retained so auth callbacks and existing installs continue to work.
- Structured output limits the response shape, not medical truth. The existing Responses API configuration was checked against [official OpenAI structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

## Verification

Recorded 2026-10-04. Strict TypeScript, Biome and the tracked-file secret guard passed. All 52 unit/integration tests across 12 files passed, including source compilation/tampering/stale versions, abstention, consent, quotas, owner isolation, idempotency, backup quarantine and the FSRS boundary. PostgreSQL tests use PGlite; browser persistence tests use fake-indexeddb.

The production build and standalone packaging passed. Eight Chromium journeys passed locally: private sample import/review/native restore, editing/undo/mobile, offline study/reload, approved synthetic practice, the new navigation, source-only self-check/reporting, public modern import/media/restore, and accessibility. Automated WCAG checks cover desktop/mobile core pages and dark-mode Today/Settings/Account/Help. The optional 50,000-card performance journey was not rerun in this iteration; its baseline measurements remain in `verification.md`.

Hosted results are recorded after deploying this release. Synthetic fixtures exercise the cloud; private sample content remains in its isolated guest browser and is excluded from uploads to Git/deployment services.

## Friend testing

Ask a student to import their authorized deck, find Today, start a regular review, and explain the rating buttons. Then try the optional AI switch in a timed session with enough cards for ten original reviews; expect sparse extra practice and safe abstention, not a question for every card. Try Skip, source reveal, self-check and Report. Check Account & data on a second device and verify a review arrives once. Keep a native backup.

Remaining independent work: real iOS/Android/Safari/Firefox and screen-reader testing, operator cloud recovery drills, representative history/template coverage, and evaluation with students. Qualified review remains required for broader clinical application content. See existing Phase 4 compatibility/evaluation documents for additional limits.
