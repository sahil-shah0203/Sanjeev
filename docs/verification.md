# Phase 4 beta verification

Recorded 2026-10-03/04. This is technical evidence for the supported compatibility subset, not medical approval, proof of educational benefit, or universal Anki compatibility. Phase 5/6 expansion is excluded.

## Automated and hosted evidence

| Check                     | Result and scope                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type checking and lint    | Strict TypeScript and Biome passed. Lint includes a tracked-file secret/private-deck guard; CI runs both.                                                                                                                                                                                                        |
| Unit/integration          | 47 tests across 11 files passed. PostgreSQL uses PGlite with local Auth/Storage stubs; persistence uses fake-indexeddb.                                                                                                                                                                                          |
| Build                     | Next.js 16.3.8 webpack production build and standalone packaging passed locally and on Vercel.                                                                                                                                                                                                                   |
| Local production browser  | Seven Chromium journeys passed: private sample, mobile editing/undo/exposures, offline recovery, approved synthetic adaptive check, 50,000-card search, public modern import/restore, accessibility.                                                                                                             |
| Public deployment browser | All seven Chromium journeys passed on the final Vercel release, including import/review/native restore, offline recovery, synthetic adaptive practice, mobile/desktop accessibility and 50,000-card search. Private sample content stayed in the isolated guest browser.                                         |
| Live cloud                | Synthetic Auth accounts: guest import plus review migrated; second browser downloaded matching state/head/media; an offline review survived reload and arrived once on the first browser; another account could not read documents or request media. Test accounts/media were removed afterward; no emails sent. |
| Live worker               | Railway Docker worker is healthy through Supabase's session pooler. Both fixture and real `openai:gpt-6-luna` jobs completed once on duplicate submission, produced source-linked drafts, and rejected approval from unassigned accounts. Temporary accounts/media were removed.                                 |
| Live model                | Two direct requests using authored nonmedical polygon facts: the first safely failed validation for a missing essential rubric; after clarifying the prompt, GPT-6 Luna returned a validated multiple-choice comparison draft. No medical activity was activated.                                                |
| Private sample            | 3 notes/cards, 50 media, zero missing references/history rows. Suspension preserved unless explicitly resumed. Private content excluded from Git and deployment uploads.                                                                                                                                         |
| Data safety               | Forced outbox failure rolls back the review, FSRS state, sequence and session; retry commits once. Backup integrity/reference validation, overwrite protection and guest partitioning pass.                                                                                                                      |
| Sync/RLS                  | Real push/pull handlers cover receipt payload identity, duplicate events, concurrent branches, undo, owner isolation and forged writes. Pull interruption retries when guest copying adds pending work. Hosted owner/media isolation also checked.                                                               |
| Hostile content           | Bounded ZIP/Zstandard/protobuf, traversal, duplicate entries, truncation/expansion bombs, orphan metadata, missing prompt media, script/HTML sanitization and source validation.                                                                                                                                 |
| Adaptive                  | Distinct-day triggers, deterministic rotation, time/count/teach-back limits, learning priority, exposures, recognition separation, idempotent attempts and interrupted-check recovery. Adaptive persistence never writes FSRS state.                                                                             |
| Dependencies              | `npm audit` reported zero known vulnerabilities. Exact versions/license notices recorded separately.                                                                                                                                                                                                             |

Live tests found and fixed two deployment-specific failures. Vercel initially captured the previous service worker before the post-build script ran; generation now uses the Next compiler lifecycle before asset collection. Guest copying could add work during an automatic pull; that condition now triggers a bounded retry rather than a misleading migration error.

## Performance

Windows 10.0.26100, AMD Ryzen 9 5900HS, 16 logical CPUs, about 15 GiB RAM, Node 22.11.0:

- 50,000 authored text-only cards exported/reimported through the actual archive/parser path; every card remained playable.
- 0.90 MiB package; export 16,625 ms; import 10,299 ms.
- Process RSS snapshots: 260 MiB before import, 516 MiB after. These are not peak measurements.
- Actual Chromium IndexedDB/worker Browse with 50,000 cards: local initial load/index 2,320 ms and search 83 ms; hosted run 2,337 ms and 75 ms. DOM remains paged at 50.

These are single desktop runs, not mobile/media-heavy limits. Public fixtures contain synthetic text and an authored PNG; private-sample tests are separate.

## Deployment

- Web: https://recall-sepia-seven.vercel.app — public Vercel beta.
- Verified Vercel deployment: `dpl_7qzyPGw1CDrj5DWMQSbtBcx4zchE` (2026-10-04 UTC).
- Worker: https://recall-worker-production-60b6.up.railway.app/healthz — Railway `recall-beta` / `recall-worker`.
- Supabase: both migrations applied; Auth, private `recall-media` Storage, documents, receipts, jobs, reviewer scopes and RLS configured.
- Web flags expose opt-in adaptive/generation controls. All generated tasks require current sources and assigned reviewer approval. The worker uses `openai:gpt-6-luna` with a $1 global daily reservation ceiling. `.env.example` defaults remain fixture/off for development.

Standard token rates were checked against the [official GPT-6 Luna page](https://developers.openai.com/api/docs/models/gpt-6-luna): $0.10/M input and $0.50/M output. The ledger reserves a conservative bound; it is not invoice telemetry. Recheck rates when changing model or processing tier.

## Remaining independent gates

- Confirm hosted email delivery and callback allowlists; confirmed synthetic accounts do not prove SMTP delivery.
- Qualified medical reviewers, approved medical activities, representative students and the evaluation protocol. Immediate repairs do not prove lasting learning.
- Real iOS/Android/Safari/Firefox, screen readers and quota/eviction behavior.
- Authorized personal histories, image-heavy collections and broader target template/occlusion fixtures. Exact limitations: `import-compatibility.md`.
- Operator database **and** Storage recovery drill and measured RPO/RTO. Native backup restoration is tested; cloud disaster recovery is separate.
- Local Docker Compose web stack is supplied but not run here; the Railway worker container is verified.

This is a deployable technical beta. Broader medical-pilot/adoption evidence remains open; no Phase 5/6 completion is claimed.
