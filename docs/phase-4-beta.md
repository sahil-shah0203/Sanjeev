# Phase 4 beta execution checklist

Source of truth: the root research guide (§6–9) and build specification (§2, §18–21). This checklist records evidence, not completion inferred from UI. Phase 5/6 expansion is excluded.

## Baseline

- [x] Preserve existing implementation and push a sanitized baseline to GitHub (`572a14e`).
- [x] Audit the current code and run baseline tests (36 tests).
- [ ] Add a tracked-file secret guard and a real lint gate; run both in CI.

## Core reliability

- [ ] Public synthetic modern/legacy Anki corpus, including placeholder selection, media and malformed files.
- [ ] Atomic-review rollback/retry and source/backup integrity regression coverage.
- [ ] Sync retry payload identity, two-device conflict and tenant isolation regression coverage.
- [ ] 50,000-card import/search/performance evidence, with measured limits.
- [ ] Production browser import, review, offline reload, backup/restore, accessibility and keyboard journeys.

## Adaptive beta

- [ ] Deterministic, versioned selection reasons: distinct-day failures, recall/application gap, repeated confusions, diagnostic sampling, explicit help.
- [ ] Rotate formats for the same objective; keep cognitive task independent of format.
- [ ] Count, total-time and teach-back limits, learning-step priority and session exposure protection.
- [ ] Persist intervention lifecycle on display so reload/dismissal cannot bypass caps; no adaptive FSRS writes.
- [ ] Synthetic fixtures for recall, comparison, explanation and application; medical sources abstain in fixture mode.
- [ ] Source-bound validation, review states, uncertainty, targeted repair, disputes and separate evidence dimensions.

## Services and release

- [ ] Railway worker packaging, health/recovery, credential check and deployment if authorized credentials are available.
- [ ] Supabase migrations/Storage/RLS and isolated live smoke accounts; real two-browser synchronization.
- [ ] Vercel beta deployment and deployed guest/import/study/offline checks.
- [ ] README, environment/migration/deployment/compatibility docs and friend-testing instructions match verified behavior.
- [ ] Final validation and push of deployed source to GitHub.

Qualified medical review, real student workflow validation and device-specific performance remain independent release gates. Never describe synthetic tests as clinical approval or educational efficacy evidence.
