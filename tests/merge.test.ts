import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { demoBundle } from "../apps/web/features/demo";
import { Library, commitImport, editNote } from "../apps/web/lib/db/local";
import { mergeImport } from "../apps/web/features/merge";
import { hash, id } from "@recall/domain";
async function updateBundle() {
  const b = await demoBundle(),
    namespace = id();
  b.report.namespace = namespace;
  for (const rows of [b.notes, b.cards, b.decks])
    for (const row of rows) row.namespace = namespace;
  return b;
}
it("updates known source identities without resetting schedules or deleting cards absent from a subset", async () => {
  const db = new Library(id());
  try {
    const old = await demoBundle();
    await commitImport(db, old);
    const states = await db.states.toArray(),
      incoming = await updateBundle();
    incoming.report.hash = await hash("changed-package");
    incoming.notes[0].fields[0] =
      "A triangle has {{c1::three}} straight sides.";
    incoming.notes[0].version = await hash(
      JSON.stringify(incoming.notes[0].fields),
    );
    incoming.cards = incoming.cards.slice(0, 1);
    incoming.notes = incoming.notes.slice(0, 1);
    const result = await mergeImport(db, incoming, old.report.namespace);
    expect(result.updated).toBe(1);
    expect(await db.cards.count()).toBe(6);
    expect(await db.states.toArray()).toEqual(states);
    expect((await db.notes.get(old.notes[0].id))?.version).toBe(
      incoming.notes[0].version,
    );
    await expect(
      mergeImport(db, incoming, old.report.namespace),
    ).rejects.toThrow("already applied");
  } finally {
    await db.delete();
  }
});
it("retains local edits and rejects changed templates before making a partial update", async () => {
  const db = new Library(id());
  try {
    const old = await demoBundle();
    await commitImport(db, old);
    await editNote(db, old.notes[0], ["Local {{c1::answer}}", "extra"]);
    const incoming = await updateBundle();
    incoming.report.hash = await hash("new-copy");
    incoming.notes[0].fields[0] = "Incoming {{c1::answer}}";
    incoming.notes[0].version = await hash(
      JSON.stringify(incoming.notes[0].fields),
    );
    expect(
      (await mergeImport(db, incoming, old.report.namespace)).conflicts,
    ).toBe(1);
    expect((await db.notes.get(old.notes[0].id))?.fields[0]).toContain("Local");
    expect(
      await db.meta.filter((m) => m.id.startsWith("claim-conflict")).count(),
    ).toBe(1);
    incoming.types[0].fields.push("Unexpected");
    await expect(
      mergeImport(db, incoming, old.report.namespace),
    ).rejects.toThrow("templates differ");
  } finally {
    await db.delete();
  }
});
