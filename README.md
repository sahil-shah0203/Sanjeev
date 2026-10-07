# Sanjeev AI

A local-first study application built from the two learning/build guides in this repository. It imports Anki packages, runs ordinary FSRS review offline, preserves source data, and offers optional source-based AI exercises. The Phase 4.5 interface uses warm paper colors, combines study preferences and account controls, and includes a short Help guide.

**Release status: Phase 4.5 technical beta.** Try [production](https://sanjeevstudy.com) or [QA](https://sanjeev-qa.vercel.app). Vercel hosts the web app, Supabase provides Auth/Postgres/private Storage, and Railway runs the durable worker. Ordinary study requires neither login nor AI. This beta does not establish medical correctness, educational benefit, or universal Anki compatibility. See [QA adaptive practice](docs/qa-adaptive-practice.md), [Phase 4.5 behavior and verification](docs/phase-4.5-release.md), [friend testing](docs/beta-testing.md), and [remaining owner tasks](docs/manual-setup.md). Phase 5 and Phase 6 are outside this release.

## Run it

Dependencies are already installed in this workspace. For a new checkout, use Node 22.12 or newer and install dependencies first. The build was also exercised on the supplied Windows/Node 22.11 machine; one dependency recommends 22.12+.

```sh
npm ci
npm run dev
```

Open <http://localhost:3000>. No environment variables, login, or AI key are needed for local study. Use **Import deck**, or try the six synthetic demonstration cards. `forsahil.apkg` remains a private local fixture and is excluded from Git and Docker images.

For the production server and offline support:

```sh
npm run build
npm run start
```

The build packages a standalone Next.js server with its assets. `PORT` changes the listening port. Offline caching is intentionally disabled in development. In the production app, open a deck and choose **Check offline readiness** while connected before disconnecting.

The repository also includes `pnpm-workspace.yaml` and a pinned `pnpm-lock.yaml` for pnpm 10.34.6. Equivalent commands are `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm build`, and `pnpm start`. `package-lock.json` is retained for the npm installation exercised in this workspace. Update both lockfiles when changing dependencies.

## What is implemented

- Browser-worker imports for all three current Anki package versions: `collection.anki2`, `collection.anki21` (with or without version metadata), and modern Zstandard/protobuf `collection.anki21b`. Streaming package checksums, real inventory, preview, cancel, resource limits, missing-media diagnostics, and explicit unsupported-card quarantine.
- Safe basic/reversed/conditional/cloze rendering, the supported AnKing pattern, controlled audio, math, image zoom, built-in image-occlusion shapes and Image Occlusion Enhanced raster/static-SVG masks. Deck scripts are not executed.
- Deterministic `ts-fsrs@5.4.2` scheduling, due/new separation, study-day rollover, sibling burying, keyboard review, durable atomic saves, undo, session resume, and no-attempt exposure tracking.
- Browsing/search in a worker with paged results; note editing with revisions; suspend, bury, flag, and source reports.
- Explicit fresh import or conservative replay of complete standard personal histories. First due calendar days are preserved in the confirmed export timezone. Incomplete, filtered, or manually rescheduled histories require a supported re-export or an explicit fresh start.
- Explicit updates to a known collection without resetting Sanjeev AI schedules. Local edits remain preserved as conflicts. Changed templates/media require a separate collection.
- Checksummed native backup/clean-profile restore, including schedules, histories, local conflict proposals, media, and original archives present on this device. Content-only Anki export with transformation warnings.
- Optional Supabase email authentication, owner-separated browser libraries, resumable guest copying, transactional server reconciliation, idempotent mutation receipts, paginated pulls, private media, and account deletion.
- Optional source-grounded draft generation, persistent leased worker, quotas/spend reservations, protected human review and authoring, report resolution, deterministic grading/self-check, disputes, and bounded adaptive delivery. Normal review has no model dependency.
- Versioned adaptive selection, independent task/format choices, format rotation, distinct-day difficulty triggers and seeded diagnostics. Display, skips, feedback time and interrupted checks persist across reloads. Recognition, unaided recall, explanation, application, assistance and exposure remain separate; generated activities never write the original FSRS schedule.
- Responsive desktop/mobile interface, dark/light appearance, keyboard controls, native modal focus handling, truthful local/cloud status, and progress views that separate types of observed evidence.

## Limits to understand

Read [import compatibility](docs/import-compatibility.md) before moving a real collection. All current container versions are handled; arbitrary add-on scripts, nested clozes, unsupported built-in occlusion shapes, active or unsupported SVG graphics, full Anki scheduling round trips, AnkiWeb sync, and AnkiHub updates remain outside the supported subset. Larger than 512 MiB packages must be exported as smaller selections; there is no hosted large-import service. The 414 MiB local version-2 regression sample imports all 1,437 cards and 3,738 media entries.

History replay uses Sanjeev AI's pinned defaults, not a claim to reproduce every Anki scheduler configuration. Untested histories are preserved rather than guessed. The replay fixture corpus is synthetic; representative authorized personal histories still need validation.

Sync preserves a single canonical review chain and retains conflicting branches as audit history without double credit. Conflict export is available in Account & data; automatic merging of extended divergent histories is deliberately absent. Original `.apkg` archive Blobs remain on the importing device and in its native backup; cloud sync carries normalized source/raw metadata and media, not the archive Blob itself.

Native restore quarantines generated practice until it is reviewed again. A checksum detects corruption; it is not proof of medical approval. Browser storage can be cleared or evicted. Keep an independent native backup.

## Verification commands

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:sample
npm run test:performance
npm audit
```

Browser tests use an already-running server at `http://localhost:3000`. To exercise the production/offline path, build/start first and set `TEST_PRODUCTION=1`; `TEST_BASE_URL` can point to a different port. CI starts the production server automatically. Private-sample tests skip when that file is absent. Synthetic tests do not require it.

`tests/e2e/import-compatibility.spec.ts` verifies exact masked pixels, reveal/zoom, offline reload and a saved review using authored synthetic media. Set `PRIVATE_APKG` to the local BlueLink sample's path to additionally run its 414 MiB import/inventory/study check in an isolated guest browser. That optional test expects this specific sample's counts. It never signs in, syncs the deck or sends its contents to an AI provider. Keep private packages and browser artifacts out of commits and deployment uploads.

See [verification](docs/verification.md) for actual results and limits. The suite covers PostgreSQL RLS, the real reconciliation handlers, hostile archives, scheduler transitions, source updates, restore, and browser journeys. Automated tests do not establish educational benefit or qualified medical correctness.

For the 50,000-card benchmarks, set `PERF_CARDS=50000` for `npm run test:performance` and `PERF_BROWSER=1` for the production browser suite. To repeat the live cloud smoke, explicitly set `SMOKE_ORIGIN` and run `npx tsx scripts/smoke-cloud.ts` with the test project's server credentials; `SMOKE_GENERATION=1` also exercises the durable draft job. It creates synthetic accounts, sends no emails, and deletes only those accounts and their media. A paid provider may incur one bounded request. Use a dedicated staging project when developing new automated tests.

For the Phase 4.5 hosted source-only flow, use the same environment with `npx tsx scripts/smoke-source-practice.ts`. It imports twelve synthetic cards, opts in, checks a real worker exercise after ten original reviews, reports it, verifies no FSRS credit and revoked consent, then removes its synthetic account. It may incur up to three bounded provider requests.

## Deployment and configuration

Copy `.env.example` to the ignored root `.env` and `apps/web/.env.local` for local services. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are public build-time configuration. `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `LLM_API_KEY` are server secrets. `APP_ORIGIN` must exactly match the web origin. Apply both SQL migrations in `supabase/migrations` once using `supabase link` and `supabase db push`.

Use Supabase's session pooler on IPv4-only hosts. Configure Auth Site URL as `https://recall-sepia-seven.vercel.app` and allow `/auth/callback` on that origin. Vercel deploys from the root using `vercel.json`; run `npx vercel@latest deploy --prod`. The Next compiler hook generates the service worker before Vercel collects public assets; production builds also package a standalone server.

Railway configuration lives in `.railway/railway.ts`, with `Dockerfile.worker` and `/healthz`. Run `railway config plan`, review the changes, then `railway config apply --yes` and `railway up --service recall-worker`. Existing secrets use `preserve()`. The worker needs `DATABASE_URL`, `ENABLE_AI_GENERATION`, and the `LLM_*` variables listed in `.env.example`; it recovers from database outages and rechecks source/approval versions before publication. Imports and exports run in bounded browser workers; large hosted import/export jobs are not implemented.

`ENABLE_ADAPTIVE_PRACTICE` and `ENABLE_AI_GENERATION` are deployment flags. `ENABLE_SOURCE_PRACTICE=true` on both web and worker enables the Phase 4.5 toggle when those two flags are also enabled on the web. Signed-in learners opt in per timed session; ordinary study stays available to guests and offline. The model selects an explicit source exercise and code compiles its content from the note. These activities have a distinct `source_bounded` state, never medical approval. Broader drafts still require assigned human review, and clinical application is excluded from this learner mode. `LLM_PROVIDER=fixture` supports synthetic notes only; `openai` uses the configured model and existing spend ceiling. See [the exact boundaries and limits](docs/phase-4.5-release.md).

## Project map

| Location | Role |
| --- | --- |
| `apps/web` | Next.js routes, UI, local database, workers, authenticated APIs |
| `apps/worker` | Persistent generation/grading worker with leases and cancellation |
| `packages/domain` | Shared types, IDs, versions, runtime schemas |
| `packages/importer`, `card-renderer`, `exporter` | Anki/content portability boundaries |
| `packages/scheduler`, `sync`, `learning`, `ai` | Scheduling, event reconciliation, learning policy, provider adapters |
| `supabase/migrations` | Owner-scoped SQL schema, RLS, private bucket, jobs |
| `tests` | Synthetic/public tests; private sample remains outside source control |
| `docs` | Setup, operations, compatibility, architecture decisions, evaluation |

Start with [manual setup](docs/manual-setup.md). For maintenance use [operations](docs/operations.md), [data dictionary](docs/data-dictionary.md), [architecture decisions](docs/adr/0001-implementation-boundaries.md), and [evaluation plan](docs/evaluation.md).
