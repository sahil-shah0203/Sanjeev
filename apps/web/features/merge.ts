import {
  hash,
  id,
  now,
  stableJson,
  type ImportBundle,
  type Note,
  type SourceCard,
  type CardState,
} from "@recall/domain";
import { compatibility } from "@recall/card-renderer";
import { freshState, configFor } from "@recall/scheduler";
import { Library, enqueue, preferences } from "../lib/db/local";

/** Explicit source-lineage update. Existing memory states are never rewritten. */
export async function mergeImport(
  db: Library,
  bundle: ImportBundle,
  namespace: string,
) {
  if (namespace === bundle.report.namespace)
    throw new Error("Choose an existing collection to update.");
  const [
    existingNotes,
    existingCards,
    existingDecks,
    allTypes,
    existingMedia,
    stagedMedia,
    prefs,
  ] = await Promise.all([
    db.notes.where("namespace").equals(namespace).toArray(),
    db.cards.where("namespace").equals(namespace).toArray(),
    db.decks.where("namespace").equals(namespace).toArray(),
    db.types.toArray(),
    db.media.where("namespace").equals(namespace).toArray(),
    db.media.where("namespace").equals(bundle.report.namespace).toArray(),
    preferences(db),
  ]);
  if (!existingDecks.length)
    throw new Error("The selected collection no longer exists.");
  const existingTypeIds = new Set(existingNotes.map((n) => n.typeId));
  const types = allTypes.filter((t) => existingTypeIds.has(t.id));
  const typeIds = new Map<string, string>();
  for (const type of bundle.types) {
    const existing = types.find((t) => t.originalId === type.originalId);
    if (
      !existing ||
      stableJson({
        fields: existing.fields,
        kind: existing.kind,
        templates: existing.templates,
      }) !==
        stableJson({
          fields: type.fields,
          kind: type.kind,
          templates: type.templates,
        })
    )
      throw new Error(
        "Note types or templates differ. Import as a separate copy to preserve both collections.",
      );
    typeIds.set(type.id, existing.id);
  }
  const media = bundle.media.length ? bundle.media : stagedMedia;
  for (const incoming of media) {
    const old = existingMedia.find((m) => m.name === incoming.name);
    if (old && old.hash !== incoming.hash)
      throw new Error(
        `Media changed under the same filename (${incoming.name}). Use a separate copy to preserve both versions.`,
      );
  }
  const at = now(),
    noteIds = new Map<string, string>(),
    deckIds = new Map<string, string>();
  const notes: Note[] = [],
    cards: SourceCard[] = [],
    states: CardState[] = [],
    conflicts: { id: string; value: unknown }[] = [];
  for (const incoming of bundle.notes) {
    const old = existingNotes.find(
      (n) => n.originalId === incoming.originalId && n.guid === incoming.guid,
    );
    noteIds.set(incoming.id, old?.id ?? incoming.id);
    if (old && old.version !== incoming.version && old.revisions.length) {
      conflicts.push({
        id: `claim-conflict:source:${old.id}:${bundle.report.id}`,
        value: { local: old, incoming },
      });
      continue;
    }
    if (old && old.version === incoming.version) continue;
    notes.push({
      ...incoming,
      id: old?.id ?? incoming.id,
      namespace,
      typeId: typeIds.get(incoming.typeId)!,
      revisions: old
        ? [...old.revisions, { version: old.version, fields: old.fields, at }]
        : incoming.revisions,
    });
  }
  const decks = bundle.decks.map((d) => {
    const old = existingDecks.find((x) => x.originalId === d.originalId);
    deckIds.set(d.id, old?.id ?? d.id);
    return { ...d, id: old?.id ?? d.id, namespace };
  });
  const notesById = new Map([...existingNotes, ...notes].map((n) => [n.id, n]));
  for (const incoming of bundle.cards) {
    const old = existingCards.find((c) => c.originalId === incoming.originalId);
    const noteId = noteIds.get(incoming.noteId)!;
    if (old && old.noteId !== noteId)
      throw new Error(
        "A card identity points to a different note. Import as a separate copy.",
      );
    const note = notesById.get(noteId)!,
      type = types.find((t) => t.id === note.typeId)!;
    const support = compatibility(type, note, incoming.ord);
    cards.push({
      ...incoming,
      ...old,
      namespace,
      noteId,
      deckId: deckIds.get(incoming.deckId)!,
      ...support,
    });
    if (!old)
      states.push(freshState(incoming.id, at, configFor(prefs.retention)));
  }
  const report = {
    ...bundle.report,
    namespace,
    status: "completed" as const,
    historyMode: "fresh" as const,
    warnings: [
      ...bundle.report.warnings,
      "Source update: existing Recall schedules and missing-from-export cards were preserved. New cards start fresh.",
      `${conflicts.length} local source conflicts were preserved for inspection.`,
    ],
  };
  await db.transaction(
    "rw",
    [
      db.notes,
      db.cards,
      db.states,
      db.decks,
      db.imports,
      db.media,
      db.outbox,
      db.meta,
      db.activities,
    ],
    async () => {
      if (
        await db.imports
          .where("hash")
          .equals(report.hash)
          .filter((r) => r.namespace === namespace)
          .count()
      )
        throw new Error("This package was already applied to this collection.");
      for (const note of existingNotes) {
        const current = await db.notes.get(note.id);
        if (current?.version !== note.version)
          throw new Error(
            "Source text changed during the update. Inspect the import again.",
          );
      }
      for (const card of existingCards) {
        const current = await db.cards.get(card.id);
        if (stableJson(current) !== stableJson(card))
          throw new Error(
            "Card settings changed during the update. Inspect the import again.",
          );
      }
      for (const [entity, values] of [
        ["decks", decks],
        ["notes", notes],
        ["cards", cards],
        ["states", states],
        ["imports", [report]],
      ] as const) {
        await db.table(entity).bulkPut(values);
        for (const value of values) await enqueue(db, entity, value.id, value);
      }
      for (const asset of media)
        if (!existingMedia.some((m) => m.name === asset.name))
          await db.media.put({ ...asset, namespace, cloud: false });
      if (stagedMedia.length)
        await db.media
          .where("namespace")
          .equals(bundle.report.namespace)
          .delete();
      await db.meta.bulkPut(conflicts);
      const changed = new Set(notes.map((n) => n.id));
      for (const activity of await db.activities.toArray())
        if (activity.sources.some((s) => changed.has(s.noteId))) {
          const value = { ...activity, status: "quarantined" as const };
          await db.activities.put(value);
          await enqueue(db, "activities", value.id, value);
        }
    },
  );
  return {
    added: states.length,
    updated: notes.length,
    conflicts: conflicts.length,
  };
}
