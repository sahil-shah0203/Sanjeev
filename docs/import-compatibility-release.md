# Anki package compatibility repair

The importer previously rejected valid `meta` version 2 because it treated any explicit metadata as version 3. It now selects the correct collection for all three current Anki container versions, retaining legacy exports without metadata and refusing to substitute a dummy compatibility collection when the real database is absent.

The same investigation identified Image Occlusion Enhanced cards that needed an adapter. The app now decodes their original source image and question/answer masks, combines the appropriate layers before display, preserves mask geometry during zoom and allows remaining masks to be hidden only after reveal. Original scripts are never executed. Static SVG is rebuilt from an explicit drawing subset at import and display boundaries; unsupported mask graphics quarantine the card instead of exposing an uncovered image. Original source and media bytes remain available for backup.

Large imports now hash the archive in 4 MiB slices, retain asset-by-asset staging, and allow up to ten minutes before cancelling. The 512 MiB package and expanded-data limits remain. A quota error gives recovery instructions; an injected mid-commit quota failure verifies that source tables, schedules and outbox writes roll back together and the prior library remains intact.

The regular-browser check also exposed an offline-shell installation failure from `Cache.addAll` ("Entry already exists"). Shell installation now fetches and stores each distinct URL with at most eight requests in flight. Every required response must succeed before installation completes; a failed cache write cannot mark the offline shell ready.

## Verification

- Type checking, lint and production build passed. All 72 unit/integration tests passed across 13 files, including new container variants, authoritative metadata, missing real collections, streaming checksum parity, cancellation, static SVG geometry/presentation, hostile SVG and missing masks, plus atomic rollback/retry.
- The private 434,251,279-byte version-2 sample parses to 1,374 notes, 1,437 supported cards and 3,738 media entries with no missing media. This includes 1,301 Image Occlusion Enhanced cards and 3,090 SVG assets. Standalone parsing took about 19 seconds on the supplied development machine; device and storage performance vary.
- Synthetic browser assertions check actual canvas pixels before/after reveal, masked zoom, answer-only mask controls, offline reload and a saved original review. The optional large-package browser test uses an isolated regular profile, checks the entire stored inventory, and focuses its test session on an actual imported masked card without changing source content or original schedules. Private-window testing also exposed a variable browser storage limit; no quota override is used to pass the regular-profile check.

Public fixtures are independently authored shapes and text. Private decks, browser profiles, screenshots and credentials remain excluded from Git and deployment archives.

## Compatibility boundary

Supporting all current container versions does not execute arbitrary add-on scripts or guarantee support for every custom template. Unknown future container versions, unsupported nested clozes/built-in occlusion shapes, unsupported SVG graphics and files exceeding resource limits remain explicit failures or quarantined cards. Details are in [the compatibility contract](import-compatibility.md). No database migration or environment change is needed for this repair.
