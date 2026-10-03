# Implementation and release gates

The two root guides are the source of truth. Checkmarks indicate verified work, not intended features.

- [x] Foundation: pinned dependencies, contracts, scheduler, importer, renderer, build and tests.
- [x] Local study: actual sample, safe media, atomic saves, undo/resume, browse/edit, backups, production offline shell.
- [x] Account implementation: optional auth, owner partitions, retry-safe guest copy, real event reconciliation, private-media adapters, RLS tests.
- [x] Adaptive implementation: source-linked drafts, validation, assigned human-review workflow, report resolution, budgeted delivery, conservative grades/disputes and leased worker.
- [x] Portability: content-only Anki export, native restore, conservative complete-history replay and explicit source updates.
- [x] Local release evidence: Chromium desktop/mobile/offline journeys, hostile fixtures, PostgreSQL tests and a 10,000-card text benchmark.
- [x] Setup, deployment packaging, recovery instructions, dependency provenance, evaluation plan and explicit compatibility limits.
- [ ] Live Supabase Auth/Storage/email, actual two-device cloud journey, Docker runtime and hosted recovery drill — requires configured infrastructure.
- [ ] Qualified medical-content approval and pilot evaluation — requires reviewers and participants.
- [ ] Broad adoption gate: authorized real-history/template fixtures, target mobile/browser/accessibility and media-heavy performance evidence; additional adapters where the target corpus requires them.

Production credentials, qualified medical review, and actual student/device evaluation are owner tasks; code completeness must not be confused with those release gates.

See [verification](verification.md) and [manual tasks](manual-setup.md). The product remains explicitly labeled technical alpha until the independent release gates are met.
