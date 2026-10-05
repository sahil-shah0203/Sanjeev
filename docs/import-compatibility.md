# Import and portability contract

Parser `recall-import-2`, schema 1, scheduler `ts-fsrs@5.4.2`. Unsupported content remains preserved, visible in diagnostics, and excluded from the study queue.

## Package formats

| Input                                                                                        | Implemented behavior                                                                                            |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Legacy version 1, with `meta` or without it                                                  | Read `collection.anki2`; JSON model/deck metadata and media map, SQLite notes/cards/revlog                      |
| Legacy version 2, with `meta` or without it                                                  | Read `collection.anki21`, ahead of the compatibility `anki2` member                                             |
| Modern `meta` version 3                                                                      | Read `collection.anki21b`; bounded Zstandard, normalized SQL tables, protobuf configs and ordered media entries |
| Unknown metadata version, missing references, malformed SQLite/protobuf                      | Abort with a diagnostic; no partial playable import                                                             |
| Encrypted archive, traversal, duplicate members, huge windows, concatenated Zstandard frames | Reject before commit                                                                                            |

The three current package versions follow [Anki's package metadata schema](https://github.com/ankitects/anki/blob/main/proto/anki/import_export.proto). Explicit metadata is authoritative: a missing newer collection never falls back to the dummy legacy collection. Without metadata, `collection.anki21` takes precedence over `collection.anki2`. Unknown future versions are rejected rather than guessed. The independently written protobuf wire reader decodes the fields used by this adapter; unknown fields remain in the original package.

Limits: 512 MiB compressed package; 128 MiB database; 64 MiB individual media; 2 GiB total expanded data; 100,000 entries; ten-minute browser-worker deadline. Package SHA-256 is computed in 4 MiB slices; media is staged one asset at a time instead of retaining all decoded media in worker memory. Individual cloud mutation records must fit below 1.9 MB. Large raw-history reports can therefore exceed cloud sync limits even if local import succeeds: retain a native backup and use smaller selected exports. These are resource bounds, not a promise that every device can import files at the bound.

## Cards

| Template/content                                                                      | Coverage                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic / reversed / optional fields                                                    | Field substitutions, `#`/`^` conditions, `FrontSide`, text/type subset                                                                                                                    |
| Cloze                                                                                 | Distinct ordinals, repeated targets, hints, sibling deletions; nested/unclosed deletions rejected                                                                                         |
| AnKing                                                                                | Native Text rendering, after-reveal resource fields, one-by-one deletion support; arbitrary template scripts/CSS are not reproduced                                                       |
| Images                                                                                | Local JPEG/PNG/WebP/GIF by bytes and validated static SVG, namespace-aware aliases, zoom; missing or unsupported prompt media quarantines the card                                        |
| Audio/video                                                                           | Local supported media with explicit playback controls; autoplay blocked                                                                                                                   |
| Math                                                                                  | KaTeX `\(...\)` and `\[...\]`; bounded expansion, trust disabled                                                                                                                          |
| Built-in image occlusion                                                              | Native unrotated normalized rectangles, ellipses, and polygons with supported hide behavior; offscreen composition before canvas display                                                  |
| Image Occlusion Enhanced                                                              | Adapter identified by Image / Question Mask / Answer Mask fields; raster or supported SVG overlays, distinct question/answer masks, masked zoom, post-answer mask toggle and extra fields |
| Other add-on scripts, unsupported built-in rotations/labels, unsupported SVG graphics | Explicit diagnostics; raw material retained                                                                                                                                               |

Source CSS, scripts, forms, event handlers, frames, arbitrary external requests, and source-provided tooltip titles are removed or blocked. This deliberately sacrifices unsupported styling to keep source packages from executing in the app. Image-occlusion coverage is a constrained adapter, not a claim of full visual parity with current Anki.

The Enhanced adapter uses an offscreen canvas and only displays a complete image-plus-mask frame. Both masks must exist and validate before the card is marked ready. The original SVG bytes remain in storage/backups; a fresh static SVG is constructed for display, including after cloud sync or restore. Supported drawings include groups, rectangles, ellipses/circles, polygons, polylines, paths, lines, text and affine transforms. Inline presentation is flattened with its original precedence. External references, scripts, event handlers, stylesheets, animation, embedded images, `use`, filters/gradients, DTDs/entities and unknown graphics fail closed. Unsupported shapes are never silently removed from a question mask. SVG is bounded to 1 MiB, 4,096 elements, depth 32 and 40 million pixels. This does not execute the original add-on JavaScript or reproduce every customized template.

## Verified private sample

`forsahil.apkg` has SHA-256 `76a915e731d568e4c705501af8b8fa49c25fb49972aae4517d74ebd06d3035b3`. The actual modern collection yields 3 notes, 3 supported card identities, 50 media entries, no missing media, and no review-log rows. All three source cards are suspended (`queue=-1`) and have no repetitions.

The guide's 34 WebP / 14 PNG / 2 JPEG inventory describes **filename extensions**. File signatures are 46 WebP / 3 PNG / 1 JPEG. Recall detects MIME from bytes rather than trusting extensions. The original file and screenshots containing its content are excluded from Git and Docker.

An additional local version-2 sample of 434,251,279 bytes (about 414 MiB) was verified with 1,374 notes, 1,437 supported cards and all 3,738 media entries, with zero missing media. It includes 1,301 Image Occlusion Enhanced cards and 3,090 SVG assets. Only aggregate verification results and independently authored synthetic fixtures belong in this repository; the package and all private media remain ignored.

## Scheduling choices

- **Fresh:** no history, or the learner explicitly accepts a fresh start. Original scheduling columns and logs are retained in the import report and original archive.
- **Replay complete history:** requires personal ownership and confirmation that Settings' timezone matches the export. Every previously studied card must currently be in ordinary review, have a complete count of standard rated learning/review/relearning logs beginning in initial learning, and end in a compatible review state under Recall's scheduler. All timestamps and source-relative due dates are checked. Source due days are preserved using calendar arithmetic and the configured study-day rollover; a preview shows the dates a pure replay would otherwise suggest. Future intervals can differ from Anki.
- **Unsupported:** filtered decks, manual rescheduling/unrated rows, incomplete logs, current learning/relearning, and incompatible state/configuration are not guessed. Export a compatible selection or explicitly start fresh. Direct import of arbitrary Anki FSRS memory-state/parameter versions is not implemented.

Replay reconstructs memory from ratings and times using the pinned default adapter. It never equates SM-2 ease with FSRS stability/difficulty. The original logs remain source history, separate from new qualifying Recall review events. A hidden legacy due-only code path remains for schema compatibility and is not offered as a validated UI migration.

## Duplicates and source updates

The same completed package hash is rejected on normal reimport. A different export starts a separate namespace unless the learner explicitly chooses an existing collection. Updates match original card/note IDs, note GUIDs, and identical note-type/template layouts. They preserve existing Recall states and cards absent from a subset export. Locally revised text is retained with the incoming proposal in Settings' conflict audit. Changed template schemas or a different media hash under the same filename require a separate copy; these are never silently overwritten.

Suspension is preserved unless explicitly resumed. Source bury state is reported and imported as available. New cards added by a source update start fresh. Generated items whose source versions change are quarantined.

## Exports and recovery

Native `.recall` archives contain schema/version/checksums, source tables, states, review/undo/exposure/attempt history, preferences, conflict proposals, media, and original package Blobs present locally. Restore checks identities, schemas, references, and hashes before an atomic write to an empty library. Medical practice from a backup is quarantined pending fresh approval. Restored review audits sync without being scheduled a second time.

Anki `.apkg` export is **content only**: note/card identities, field order, tags, media, suspension, and supported templates. AnKing is transformed to a standard cloze with a report. Verify unsupported/custom types in Anki before depending on that export. Scheduling/history interoperability and ongoing AnkiWeb/AnkiHub integration are not supplied by content export. Native backup is the way to preserve Recall progress.
