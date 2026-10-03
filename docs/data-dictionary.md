# Data and trust boundaries

Dates are UTC ISO strings; source Anki identifiers are decimal strings. App IDs are UUIDs. The native/archive and API envelope version is 1. FSRS state snapshots serialize explicit dates and pinned configuration.

| Local table / document entity | Meaning                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| imports                       | Package hash, parser format/version, counts, warnings, raw collection/revlogs, chosen migration mode; archive Blob is local-only |
| types / notes / decks / cards | Ordered source schema/fields, GUIDs/original IDs, revisions, namespaced identities, support and availability flags               |
| media                         | Local Blob, original alias, detected MIME, content hash, availability; cloud metadata has an owner and private object key        |
| states                        | Current memory state, version, canonical head, migration origin and scheduler config                                             |
| reviews / undos               | Append-only review events and compensating undo proposals; canonical/concurrent/undone status                                    |
| exposures                     | Reveal/no-attempt/source/adaptive/hint/skip observations that do not automatically change scheduling                             |
| sessions                      | Budget, active review time, offered-check count, intervention time, teach-back count, excluded cards and completion              |
| activities                    | Versioned objective, cognitive task, format/key/rubric, rationale, immutable source references, approval status and provenance   |
| attempts                      | Saved answer/version/timing, conservative grade, assistance/contamination, dispute/adjudication and optional model annotation    |
| reports                       | Card/activity issue and open/resolved state                                                                                      |
| preferences                   | Timezone/rollover, new cap, retention, appearance and separate adaptive/AI/evaluation preferences                                |
| outbox                        | Stable mutation ID, type, entity, base version, timestamp and serialized payload                                                 |
| meta                          | Device sequence, pull cursor/row versions, claim markers, staging timestamps and retained conflict proposals                     |

Cloud source/study documents use a typed JSONB envelope keyed by `(owner_id, entity, id)`, with row version, timestamps, tombstone, source-reference triggers, owner RLS, and a monotonic change log. Shared Zod schemas validate executed fields at sync and restore boundaries. Raw source metadata is preserved without executing it.

`mutation_receipts` provides retry idempotency and stores rejected/conflicting proposals. Browser Auth credentials can read owner records but cannot bypass the server's scheduling/approval rules through direct table writes. The server temporarily sets a constrained `recall_server` role and owner identity within each transaction. Storage has separate owner-path policies.

Jobs, reviewer assignments, content audits and spend reservations are server-only operational tables. A collection owner ID entered in the reviewer UI grants no access by itself; authorization requires an administrator-assigned scope.

Source, review, and adaptive records have separate responsibilities. The original review adapter rejects generated, assisted, unattempted, and contaminated successes. New medical generation cannot write original schedules. An uncertain or disputed alternate answer is not counted as a confident evidence observation.

The current schema has no separate universal mastery model, embedding service, social data, or automatic parameter-training job. Objective descriptions and references are embedded in versioned activities; observed evidence is derived from attempts. Evaluation consent is a preference only: no experiment assignment or background analytics upload is silently performed.
