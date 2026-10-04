import "fake-indexeddb/auto";
import { it, expect, beforeEach, afterEach } from "vitest";
import {
  Library,
  commitImport,
  startSession,
  saveReview,
  undoReview,
  editNote,
} from "../apps/web/lib/db/local";
import { exportLibrary, restoreLibrary } from "../apps/web/features/backup";
import { demoBundle } from "../apps/web/features/demo";
import { id } from "@recall/domain";
let db: Library;
const storage = new Map<string, string>();
beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { persist: async () => false } },
  });
  db = new Library(id());
});
afterEach(async () => {
  await db.delete();
});
it("commits event, schedule and outbox atomically; rejects stale tabs; survives reopen and undo", async () => {
  const b = await demoBundle();
  await commitImport(db, b);
  const card = b.cards[0],
    note = b.notes[0];
  const state = (await db.states.get(card.id))!;
  const session = await startSession(db, "", 15);
  const input = {
    card,
    state,
    session,
    rating: "good" as const,
    qualification: {
      original: true,
      attempted: true,
      assisted: false,
      contaminated: false,
    },
    durationMs: 3000,
    contentVersion: note.version,
    eventId: id(),
  };
  const event = await saveReview(db, input);
  expect(await db.reviews.count()).toBe(1);
  expect(await db.outbox.get(event.id)).toBeDefined();
  await saveReview(db, input);
  expect(await db.reviews.count()).toBe(1);
  await expect(saveReview(db, { ...input, eventId: id() })).rejects.toThrow(
    "another tab",
  );
  expect(await db.reviews.count()).toBe(1);
  db.close();
  await db.open();
  expect((await db.states.get(card.id))?.head).toBe(event.id);
  await undoReview(db, event.id);
  expect((await db.states.get(card.id))?.memory).toEqual(state.memory);
  expect((await db.reviews.get(event.id))?.status).toBe("undone");
  expect(await db.undos.count()).toBe(1);
});
it("reimport does not duplicate cards or reset reviews, and source edits retain state", async () => {
  const b = await demoBundle();
  await commitImport(db, b);
  await expect(commitImport(db, b)).rejects.toThrow("already imported");
  expect(await db.cards.count()).toBe(6);
  const state = await db.states.get(b.cards[0].id);
  await editNote(db, b.notes[0], ["Changed {{c1::target}}", "Updated extra"]);
  expect(await db.states.get(b.cards[0].id)).toEqual(state);
  expect((await db.notes.get(b.notes[0].id))?.revisions).toHaveLength(1);
});
it("rolls back schedule, event, sequence and session when outbox persistence fails", async () => {
  const bundle = await demoBundle();
  await commitImport(db, bundle);
  const card = bundle.cards[0];
  const state = (await db.states.get(card.id))!;
  const session = await startSession(db, "", 15);
  const before = {
    outbox: await db.outbox.count(),
    sequence: await db.meta.get("sequence"),
  };
  const eventId = id();
  const fail = (_key: unknown, value: { kind?: string }) => {
    if (value.kind === "review")
      throw new Error("Simulated storage exhaustion");
  };
  db.outbox.hook("creating", fail);
  const input = {
    card,
    state,
    session,
    rating: "good" as const,
    qualification: {
      original: true,
      attempted: true,
      assisted: false,
      contaminated: false,
    },
    durationMs: 2000,
    contentVersion: bundle.notes[0].version,
    eventId,
  };
  await expect(saveReview(db, input)).rejects.toThrow(
    "Simulated storage exhaustion",
  );
  expect(await db.states.get(card.id)).toEqual(state);
  expect(await db.reviews.count()).toBe(0);
  expect(await db.sessions.get(session.id)).toEqual(session);
  expect(await db.outbox.count()).toBe(before.outbox);
  expect(await db.meta.get("sequence")).toEqual(before.sequence);
  db.outbox.hook("creating").unsubscribe(fail);
  await saveReview(db, input);
  expect(await db.reviews.count()).toBe(1);
});
it("restores a complete library into a clean profile, refuses overwrite, and partitions owners", async () => {
  await commitImport(db, await demoBundle());
  const backup = await exportLibrary(db);
  const other = new Library(id());
  try {
    expect(await other.cards.count()).toBe(0);
    await restoreLibrary(other, backup);
    expect(await other.cards.count()).toBe(6);
    expect(await other.states.count()).toBe(6);
    await expect(restoreLibrary(other, backup)).rejects.toThrow(
      "empty library",
    );
  } finally {
    await other.delete();
  }
});
