# Verification and remaining release gates

Recorded 2026-10-03. This is evidence for the technical alpha, not certification of every Anki format or a medical learning outcome.

## Completed automated checks

| Check                   | Result / scope                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript strict check | Passed                                                                                                                                                                                                 |
| Vitest                  | 36 tests across 8 files passed                                                                                                                                                                         |
| Production build        | Next.js 16.3.8 webpack build, standalone server and versioned offline shell passed                                                                                                                     |
| Chromium journeys       | 4 production journeys passed: sample/import/review/reload/backup/restore; mobile edit/undo/no-attempt; offline study reload/save; approved adaptive self-check with unchanged original-card scheduling |
| Private sample          | 3 notes, 3 cards, 50 media, no missing refs, 0 revlogs; source suspension preserved unless explicitly resumed                                                                                          |
| Dependency audit        | 0 known vulnerabilities reported by `npm audit` after updating Vitest to 4.1.11                                                                                                                        |
| Native restore          | Fresh-profile restore, integrity tamper rejection, overwrite protection, archived cloud history without replay                                                                                         |
| Server reconciliation   | Actual push/pull code on embedded PostgreSQL, duplicate receipts, owner isolation, concurrent offline branches, undo and malformed/forged payload rejection                                            |
| SQL authorization       | Migrations applied to embedded PostgreSQL with Supabase-compatible Auth/Storage stubs; owner RLS, storage paths, reference checks, browser-write bypass rejection                                      |
| Worker lifecycle        | Lease claim, cancellation, wrong/expired lease publication rejection, no automatic paid retry                                                                                                          |
| Migration/source update | Complete synthetic history replay, DST due dates, unsupported-history rejection, source conflicts, missing-from-subset retention, state preservation                                                   |

The in-app Browser tool could not initialize because its sandbox metadata was unavailable. Automated Playwright Chromium was installed and used instead. Desktop and mobile screenshots were visually inspected. This does not substitute for real iOS/Android devices or screen-reader testing.

## Performance observation

`npm run test:performance` generated, exported and reimported 10,000 distinct synthetic text-only cards through the actual archive/parser path. On Windows 10.0.26100, Node 22.11.0, AMD Ryzen 9 5900HS (16 logical CPUs), approximately 15 GiB RAM:

- 0.18 MiB compressed package.
- 3,462 ms content export; 1,992 ms import.
- Process RSS snapshots: 191 MiB before import, 234 MiB after.
- All 10,000 card identities remained playable.

These are one-run Node measurements. RSS snapshots are not peak memory. They do not measure browser commit/search latency, media-heavy collections, low-memory phones, or a maximum supported deck size. `PERF_CARDS` accepts up to 50,000 for larger local trials. Raw output is in the ignored `test-results/performance.json` when generated.

## Test environment

Local browser: Playwright 1.63.0 Chromium 153.0.8010.12 (headless), desktop 1280×720 and mobile viewport 390×844. IndexedDB unit persistence tests use fake-indexeddb; browser journeys use actual Chromium IndexedDB. SQL tests use PGlite's actual PostgreSQL engine with local Auth/Storage schema stubs, not hosted Supabase services. No live provider API call is counted as tested.

Private-sample tests explicitly skip in public CI when `forsahil.apkg` is absent. CI runs all synthetic tests and production browser journeys; the included GitHub Actions workflow has not been executed on a remote repository during this build. Docker is unavailable here, so the provided container/local-Supabase configuration needs its first runtime check.

## Live deployment checklist

Complete these after [manual setup](manual-setup.md), using two separate browser profiles/devices:

1. Sign in through actual email delivery; confirm callback origin and refreshed sessions.
2. Claim a guest library, interrupt/retry during upload, and confirm source/history/media counts with no reset.
3. Sign in as the same user on device B; compare card state/head and render downloaded images/audio.
4. Go offline on both devices. Review the same card independently, reconnect in both possible orders, and verify one canonical extension with the other event preserved. Check delayed descendants and undo conflicts.
5. Review different cards offline, reload before reconnecting, and verify all intended events arrive once.
6. Switch between two accounts; confirm that notes, activity approvals, storage objects and local UI remain partitioned.
7. Download and restore a native backup into a fresh profile; test your actual hosting database/storage restore procedure.
8. Exercise sign-out with pending changes, cancelled jobs, rejected approval attempts, reported content quarantine, and typed-confirmation cloud deletion.
9. Complete one synthetic fixture job, then one consented live provider draft with a spend limit; verify that only assigned human approval makes it eligible.

Before daily-study adoption, add authorized fixtures from the intended Anki versions, real personal SM-2/FSRS histories, larger image-heavy decks and the target image-occlusion corpus. Test Safari/iOS, Firefox and Android; verify keyboard/focus, screen reader, zoom, contrast, and denied/evicted/quota-limited storage. Extended divergent-history reconciliation and broad unsupported-template adapters require additional engineering if those cases are required by the pilot.

## Scope gates

- **Technical alpha:** implemented and locally tested within the compatibility matrix.
- **Medical pilot:** pending qualified content review, live-service/device verification and an agreed evaluation protocol.
- **Adoption release:** pending representative history/template/performance coverage, live recovery guarantees, cross-device operational evidence and target-user workflow validation.

Do not remove these distinctions merely because the application compiles or the sample imports successfully.
