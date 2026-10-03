# Import and portability contract

Parser `recall-import-1`, schema 1, scheduler `ts-fsrs@5.4.2`. Unsupported content remains preserved, visible in diagnostics, and excluded from the study queue.

## Package formats

| Input                                                                                        | Implemented behavior                                                                                            |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Legacy ZIP with `collection.anki2`                                                           | JSON model/deck metadata, SQLite notes/cards/revlog, JSON media map                                             |
| ZIP with `collection.anki21`, no `meta`                                                      | Select that collection ahead of the compatibility `anki2` member                                                |
| Modern `meta` version 3                                                                      | Read `collection.anki21b`; bounded Zstandard, normalized SQL tables, protobuf configs and ordered media entries |
| Unknown metadata version, missing references, malformed SQLite/protobuf                      | Abort with a diagnostic; no partial playable import                                                             |
| Encrypted archive, traversal, duplicate members, huge windows, concatenated Zstandard frames | Reject before commit                                                                                            |

The independently written protobuf wire reader decodes only the fields used by this adapter. Unknown fields remain in the original package; it is not a complete implementation of every upstream protobuf schema. `meta` values other than 3 are rejected rather than guessed, including explicit older metadata variants. Legacy exports without `meta` remain supported.

Limits: 512 MiB compressed package; 128 MiB database; 64 MiB individual media; 2 GiB total expanded data; 100,000 entries; three-minute browser-worker deadline. Individual cloud mutation records must fit below 1.9 MB. Large raw-history reports can therefore exceed cloud sync limits even if local import succeeds: retain a native backup and use smaller selected exports. These are resource bounds, not a promise that every device can import files at the bound.

## Cards

| Template/content                                                 | Coverage                                                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Basic / reversed / optional fields                               | Field substitutions, `#`/`^` conditions, `FrontSide`, text/type subset                                                                   |
| Cloze                                                            | Distinct ordinals, repeated targets, hints, sibling deletions; nested/unclosed deletions rejected                                        |
| AnKing                                                           | Native Text rendering, after-reveal resource fields, one-by-one deletion support; arbitrary template scripts/CSS are not reproduced      |
| Images                                                           | Local JPEG/PNG/WebP/GIF by bytes, namespace-aware aliases, zoom; missing prompt media quarantines the card                               |
| Audio/video                                                      | Local supported media with explicit playback controls; autoplay blocked                                                                  |
| Math                                                             | KaTeX `\(...\)` and `\[...\]`; bounded expansion, trust disabled                                                                         |
| Built-in image occlusion                                         | Native unrotated normalized rectangles, ellipses, and polygons with supported hide behavior; offscreen composition before canvas display |
| Add-on image occlusion, rotations, labels, custom masks, scripts | Explicitly unsupported; raw material retained                                                                                            |

Source CSS, scripts, forms, event handlers, frames, arbitrary external requests, and source-provided tooltip titles are removed or blocked. This deliberately sacrifices unsupported styling to keep source packages from executing in the app. Image-occlusion coverage is a constrained adapter, not a claim of full visual parity with current Anki.

## Verified private sample

`forsahil.apkg` has SHA-256 `76a915e731d568e4c705501af8b8fa49c25fb49972aae4517d74ebd06d3035b3`. The actual modern collection yields 3 notes, 3 supported card identities, 50 media entries, no missing media, and no review-log rows. All three source cards are suspended (`queue=-1`) and have no repetitions.

The guide's 34 WebP / 14 PNG / 2 JPEG inventory describes **filename extensions**. File signatures are 46 WebP / 3 PNG / 1 JPEG. Recall detects MIME from bytes rather than trusting extensions. The original file and screenshots containing its content are excluded from Git and Docker.

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
