# Phase 4.5 — Sanjeev beta

This iteration implements the [Phase 4.5 brief](phase-4.5-ui-and-study-mode.md). It does not claim Phase 5/6 completion, medical validation, or improved learning outcomes.

## Learner changes

- Sanjeev identity, book icon, warm beige surfaces with green accents, and a warm dark theme.
- Today holds deck/duration setup and the single optional AI switch. Starting from a deck retains that deck in Today’s setup. Import lives in Decks, with a prominent first-import action on an empty Today page.
- `/settings` contains study preferences and collapsed advanced scheduling. `/account` contains optional sign-in, automatic sync, guest migration, backup/restore, conflict export and collapsed destructive actions. Old `/settings#account` and auth-return links still redirect appropriately.
- `/help` explains importing, first review, FSRS ratings, shortcuts, optional AI, offline readiness and backups. It never blocks study. The generic “A few things to know” import panel was removed; the actual import preview still reports compatibility issues.
- Study preferences, sign-in, backup and recovery now live together on the page opened from the username/account control. The separate Settings navigation button has been removed; `/settings` remains a compatibility path.

## Exact AI scope

AI is off by default for each new session. A signed-in student can opt in for a timed session (5 minutes or longer). The toggle discloses the provider and selected-source processing. Ordinary study works offline and as a guest. Consent is stored with the session; it is independent of legacy provider consent and research enrollment. Turning AI off stops further requests/delivery in that session.

The worker asks the configured model to choose an explicit source unit or abstain. **The model cannot author the displayed medical text:** a deterministic compiler builds the exercise from the selected note and a validated recipe. Supported formats are source-text completion, recognition of exact original wording, source-visible comparison, and one-sentence restatement. Recognition alternatives are terms occurring elsewhere in the same note, not invented clinical distractors; this is a wording exercise, not a clinical best-answer question. Task and format are recorded separately.

Explicit clozes can be selected from any supported text field, including layouts with leading metadata or blank fields. Basic notes use the first usable prompt/answer text-field pair. Extras beyond that pair, tags, unrelated notes and media are excluded. Prompt/source text is limited to 1,200 characters; a basic answer is limited to 800. Nested/malformed clozes and sources without an explicit target abstain. A conservative lexical exclusion and model abstention reject clinical decision/case/dosing/management content. These filters are deliberately incomplete as medical classification; exact-source compilation is the stronger boundary. They do not validate the source, detect every patient identifier, or guarantee that a note is true. Never include patient information.

All exercises show “AI-generated · unverified” and exact source references. Free text is saved as uncertain and offers self-check annotations. Recognition is checked against its stored source-wording key. A correct, deterministically checked AI answer spaces another AI activity on that note until its next FSRS due date; skipping or an incorrect/uncertain answer does not change that spacing. This is separate from FSRS and never changes the card schedule. No model grading endpoint is called for this mode. Source-visible/previously reviewed exercises are recorded as contaminated practice, not independent mastery evidence. Original FSRS ratings remain separate.

One optional exercise can follow each ten original reviews. Extra practice is limited to 15% of the planned time, 20–30 seconds per exercise, one explanation/comparison per session, and at most three generation requests per session. Learning steps and large overdue queues take priority. Formats rotate across available source formats and previously generated items; a note with one explicit target may support only completion/restatement. The pilot does not force back-to-back questions on every card. Small decks/sessions with fewer than ten completed original reviews may never show an extra exercise.

For troubleshooting, open the browser DevTools Console and filter for `[Sanjeev AI]`. `session_enabled`, `request_started`, `request_accepted`, `question_ready`, and `question_displayed` show the request path. `question_skipped`, `question_abstained`, `request_rejected`, `request_failed`, and `request_timed_out` explain why a question was not shown. Logs include IDs, task/format, status and reason only; they do not print card text, answers, prompts, or source excerpts. AI practice requires a signed-in, online, opted-in timed session, and a supported source note.

Generation runs in the background. Failure, abstention, quotas or lack of a fitting activity leave the original review available. Display, attempt, report and interruption records persist locally and sync. A report quarantines the version for the owner and prevents new generation for that same source version pending review. A source edit invalidates the exercise. Restored backups quarantine generated content rather than treating restored metadata as trusted publication.

## Operations and compatibility

- New flag: `ENABLE_SOURCE_PRACTICE=true` on Vercel and Railway. Web also requires the existing adaptive/generation flags. Set the new flag to false to stop this pilot while keeping ordinary study available.
- Existing provider/model configuration, daily reservation ceiling, durable jobs, leases, RLS, origin checks and owner isolation are retained. No new database migration is required: the additive session and activity fields live in the existing versioned documents.
- `source_bounded` is separate from `human_approved`. Clients cannot mint either publication state through sync. The protected reviewer workflow remains at `/review-content`; it is removed from everyday navigation.
- Internal `recall-*` database names, bucket, package names, guest key, `.recall` backup format and cloud identifiers are retained for existing-data compatibility. The existing hosting URL is also retained so auth callbacks and existing installs continue to work.
- Structured output limits the response shape, not medical truth. The existing Responses API configuration was checked against [official OpenAI structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

## Verification

Recorded 2026-10-04/05. Strict TypeScript, Biome and the tracked-file secret guard passed. All 53 unit/integration tests across 12 files passed, including source compilation/tampering/stale versions, abstention, consent, quotas, owner isolation, idempotency, backup quarantine and the FSRS boundary. PostgreSQL tests use PGlite; browser persistence tests use fake-indexeddb. A hosted test exposed a route-navigation race: a new study page could inherit a pending sync from the previous closed database connection. Sync now waits for that run and continues on the current connection; a regression test reproduces the closed-connection handoff.

The production build and standalone packaging passed. Eight Chromium journeys passed locally: private sample import/review/native restore, editing/undo/mobile, offline study/reload, approved synthetic practice, the new navigation, source-only self-check/reporting, public modern import/media/restore, and accessibility. Automated WCAG checks cover desktop/mobile core pages and dark-mode Today/Settings/Account/Help. The optional 50,000-card performance journey was not rerun in this iteration; its baseline measurements remain in `verification.md`.

All eight browser journeys also passed on the hosted beta. Synthetic live accounts verified guest migration, matching review heads/state/media on a second browser, offline review/reload followed by one acknowledged sync event, and rejection of another account's source/media access. The cloud suite passed again after the navigation sync repair.

The real source-only smoke passed with `openai:gpt-6-luna`: twelve synthetic cards imported, opt-in started off, the Railway job published a bounded exercise, ten original reviews preceded its display, source references and the unverified label appeared, free text remained uncertain, self-check persisted, reporting quarantined the activity, and revoking consent returned 403 for another request. Exactly ten original reviews and one separate activity attempt reached the cloud; all original card states matched their snapshots from before the extra exercise. Tests wait for asynchronous delivery/acknowledgement rather than assuming an accepted job or a button click means sync has finished. Synthetic accounts are removed afterward; no emails are sent.

Private sample content remains in its isolated guest browser and is excluded from uploads to Git/deployment services. The normal browser suite does not invoke a model for the private sample. Real phones, screen readers, SMTP and operator disaster recovery remain independent gates.

Deployment: [Vercel beta](https://recall-sepia-seven.vercel.app), deployment `dpl_CzpN9CL8Nrc2b9666cN3nVMCe6UL`, application commit `77e96c7`, with `ENABLE_SOURCE_PRACTICE=true`; [Railway worker health](https://recall-worker-production-60b6.up.railway.app/healthz), deployment `27e77719-088d-4a97-ac06-da3dc79a5543`. No new migration or account setup is required for this iteration. Existing origin and internal data identifiers are preserved. Source is published on [GitHub](https://github.com/sahil-shah0203/Sanjeev); the subsequent documentation commit records hosted evidence.

## Friend testing

Ask a student to import their authorized deck, find Today, start a regular review, and explain the rating buttons. Then try the optional AI switch in a timed session with enough cards for ten original reviews; expect sparse extra practice and safe abstention, not a question for every card. Try Skip, source reveal, self-check and Report. Check Account & data on a second device and verify a review arrives once. Keep a native backup.

Remaining independent work: real iOS/Android/Safari/Firefox and screen-reader testing, operator cloud recovery drills, representative history/template coverage, and evaluation with students. Qualified review remains required for broader clinical application content. See existing Phase 4 compatibility/evaluation documents for additional limits.
