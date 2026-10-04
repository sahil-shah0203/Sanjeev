# Phase 4 beta execution checklist

Source of truth: the root research guide (§6–9) and build specification (§2, §18–21). This checklist records evidence, not completion inferred from UI. Phase 5/6 expansion is excluded.

## Baseline

- [x] Preserve existing implementation and push a sanitized baseline to GitHub (`572a14e`).
- [x] Audit the current code and run baseline tests (36 tests).
- [x] Add a tracked-file secret guard and lint gate, with CI configuration.

## Core reliability

- [x] Public synthetic modern/legacy Anki corpus, including placeholder selection, media and malformed files.
- [x] Atomic-review rollback/retry and source/backup integrity regression coverage.
- [x] Sync retry payload identity, two-device conflict and tenant isolation regression coverage.
- [x] 50,000-card import/search/performance evidence, with measured limits.
- [x] Production browser import, review, offline reload, backup/restore, accessibility and keyboard journeys.

## Adaptive beta

- [x] Deterministic, versioned selection reasons: distinct-day failures, recall/application gap, repeated confusions, diagnostic sampling, explicit help.
- [x] Rotate formats for the same objective; keep cognitive task independent of format.
- [x] Count, total-time and teach-back limits, learning-step priority and session exposure protection.
- [x] Persist intervention lifecycle on display so reload/dismissal cannot bypass caps; no adaptive FSRS writes.
- [x] Synthetic fixtures for recall, comparison, explanation and application; medical sources abstain in fixture mode.
- [x] Source-bound validation, review states, uncertainty, targeted repair, disputes and separate evidence dimensions.

## Services and release

- [x] Railway worker packaging, health/recovery, credential check and deployment.
- [x] Supabase migrations/Storage/RLS and isolated live smoke accounts; real two-browser synchronization.
- [x] Vercel beta deployment and deployed guest/import/study/offline checks.
- [x] README, environment/migration/deployment/compatibility docs and friend-testing instructions match verified behavior.
- [x] Final validation and push of deployed source to GitHub.

Qualified medical review, real student workflow validation and device-specific performance remain independent release gates. Never describe synthetic tests as clinical approval or educational efficacy evidence.

## Implemented experimental policy

`recall-adaptive-2` chooses only current, reviewed sources. It prioritizes two recall failures on distinct study days in 14 days, successful recall followed by failed application, repeated confusion of the same alternatives, then a seeded 1-in-5 diagnostic sample of previously successful objectives. Learning/relearning work, a backlog above 100, source exposure in this session/recently, and exhausted budgets defer automatic checks. Explicit help can exceed automatic caps and is recorded as assisted exposure.

At most one automatic check is offered per ten completed ordinary reviews; checks and repairs share 15% of planned time. Automatic teach-back occurs at most once per session with a planned duration at most 30 seconds; other automatic activities target at most 45 seconds. Feedback reading counts toward time. Display reserves the count immediately. Reload recovery conservatively charges at least the interrupted activity's estimate. A suggested-time notice offers return to ordinary review; there is no forced response timer.

Objective identity uses normalized objective wording plus source note/version references. Generation extracts a narrow objective from the selected note; it does not supply a validated cross-deck medical concept ontology. Multiple-choice recognition does not count as unaided recall. Uncertain, disputed, assisted and exposed responses do not establish mastery. Human/self-check corrections remain separate from original grades. No adaptive event updates original FSRS scheduling.
