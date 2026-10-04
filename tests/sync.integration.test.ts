import "fake-indexeddb/auto";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { testDatabase } from "./helpers/postgres";
import {
  Library,
  commitImport,
  startSession,
  saveReview,
  undoReview,
} from "../apps/web/lib/db/local";
import { copyGuest } from "../apps/web/features/claim";
import { exportLibrary, restoreLibrary } from "../apps/web/features/backup";
import { demoBundle } from "../apps/web/features/demo";
import { mutationOrder } from "@recall/sync";
import { FixtureProvider } from "@recall/ai";
import { id, type Mutation } from "@recall/domain";
const holder = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock("../apps/web/lib/server/database", () => ({
  transaction: async (
    owner: string,
    fn: (client: unknown) => Promise<unknown>,
  ) => {
    const db = holder.db!;
    await db.exec("BEGIN");
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
        owner,
      ]);
      await db.exec("SET LOCAL ROLE recall_server");
      const value = await fn(db);
      await db.exec("COMMIT");
      return value;
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  },
}));
import { push, pull } from "../apps/web/lib/server/sync";
import { enqueueSourcePractice } from "../apps/web/lib/server/source-practice";
import { compileSourceActivity } from "@recall/learning";
const alice = id(),
  bob = id(),
  libraries: Library[] = [];
const local = () => {
  const db = new Library(id());
  libraries.push(db);
  return db;
};
beforeAll(async () => {
  holder.db = await testDatabase([alice, bob]);
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { storage: { persist: async () => false } },
  });
});
afterAll(async () => {
  for (const db of libraries) await db.delete();
  await holder.db!.close();
});
async function send(owner: string, db: Library) {
  const waiting = (await db.outbox.toArray()).sort(mutationOrder);
  const receipts: any[] = [];
  for (let start = 0; start < waiting.length; start += 50) {
    const result = await push(owner, {
      schemaVersion: 1,
      mutations: waiting.slice(start, start + 50),
    });
    expect(
      result.results.every((r) => r.status !== "error"),
      JSON.stringify(result),
    ).toBe(true);
    receipts.push(...result.results);
  }
  return receipts;
}
it("gates source exercises on session consent, ownership, quotas and server-only publication", async () => {
  vi.stubEnv("ENABLE_AI_GENERATION", "true");
  vi.stubEnv("ENABLE_ADAPTIVE_PRACTICE", "true");
  vi.stubEnv("ENABLE_SOURCE_PRACTICE", "true");
  try {
    const db = local(),
      bundle = await demoBundle();
    await commitImport(db, bundle);
    const session = await startSession(db, "", 15, true);
    await send(alice, db);
    const input = {
      sessionId: session.id,
      noteId: bundle.notes[0].id,
      variant: "recall" as const,
      consent: true as const,
    };
    const first = await enqueueSourcePractice(alice, input);
    expect(await enqueueSourcePractice(alice, input)).toEqual(first);
    await expect(enqueueSourcePractice(bob, input)).rejects.toThrow(
      "Turn on AI",
    );
    await enqueueSourcePractice(alice, { ...input, variant: "restate" });
    await enqueueSourcePractice(alice, {
      ...input,
      noteId: bundle.notes[1].id,
    });
    await expect(
      enqueueSourcePractice(alice, { ...input, noteId: bundle.notes[2].id }),
    ).rejects.toThrow("limit reached");
    const a = compileSourceActivity(
      bundle.notes[0],
      { unit: 0, variant: "recall" },
      { id: id(), version: id(), modelVersion: "fixture" },
    );
    const forged = await push(alice, {
      schemaVersion: 1,
      mutations: [
        {
          id: id(),
          at: new Date().toISOString(),
          baseVersion: 0,
          kind: "put",
          entity: "activities",
          entityId: a.id,
          value: a,
        },
      ],
    });
    expect(forged.results[0].status).toBe("error");
    vi.stubEnv("ENABLE_SOURCE_PRACTICE", "false");
    await expect(enqueueSourcePractice(alice, input)).rejects.toThrow(
      "unavailable",
    );
  } finally {
    vi.unstubAllEnvs();
  }
});
it("syncs actual import outboxes, survives duplicate requests, and isolates cursor pulls", async () => {
  const device = local();
  await commitImport(device, await demoBundle());
  const receipts = await send(alice, device);
  expect(receipts.every((r) => r.status === "ok")).toBe(true);
  expect(await send(alice, device)).toEqual(receipts);
  const original = (await device.outbox.toArray()).sort(mutationOrder)[0];
  const reused = await push(alice, {
    schemaVersion: 1,
    mutations: [{ ...original, at: "2026-01-01T00:00:00.000Z" }],
  });
  expect(reused.results[0].status).toBe("error");
  expect((await pull(bob, 0, 100)).changes).toHaveLength(0);
  const first = await pull(alice, 0, 3);
  expect(first.changes).toHaveLength(3);
  expect(first.hasMore).toBe(true);
  const next = await pull(alice, first.nextCursor, 100);
  expect(next.changes.every((c) => c.cursor > first.nextCursor)).toBe(true);
});
it("retains two offline branches and validates undo against the canonical head", async () => {
  const a = local(),
    b = local(),
    bundle = await demoBundle();
  await commitImport(a, bundle);
  await commitImport(b, bundle);
  await send(alice, a);
  await a.outbox.clear();
  await b.outbox.clear();
  const card = bundle.cards[0],
    state = (await a.states.get(card.id))!,
    contentVersion = bundle.notes[0].version;
  const review = async (db: Library) =>
    saveReview(db, {
      card,
      state,
      session: await startSession(db, "", 15),
      rating: "good",
      qualification: {
        original: true,
        attempted: true,
        assisted: false,
        contaminated: false,
      },
      durationMs: 3000,
      contentVersion,
      eventId: id(),
    });
  const first = await review(a),
    second = await review(b);
  await send(alice, a);
  const receipts = await send(alice, b);
  expect(receipts.some((r) => r.conflict)).toBe(true);
  const rows = await holder.db!.query<any>(
    "SELECT entity,id,value FROM documents WHERE owner_id=$1 AND (id=$2 OR id=$3 OR (entity='states' AND id=$4))",
    [alice, first.id, second.id, card.id],
  );
  expect(rows.rows.find((r) => r.id === second.id)?.value.status).toBe(
    "concurrent",
  );
  expect(rows.rows.find((r) => r.entity === "states")?.value.head).toBe(
    first.id,
  );
  await a.outbox.clear();
  await undoReview(a, first.id);
  await send(alice, a);
  const canonical = await holder.db!.query<any>(
    "SELECT value FROM documents WHERE owner_id=$1 AND entity='states' AND id=$2",
    [alice, card.id],
  );
  expect(canonical.rows[0].value.memory).toEqual(
    JSON.parse(JSON.stringify(state.memory)),
  );
});
it("restores historical reviews to a new account without replaying them a second time", async () => {
  const source = local(),
    target = local(),
    bundle = await demoBundle();
  await commitImport(source, bundle);
  const card = bundle.cards[0];
  const event = await saveReview(source, {
    card,
    state: (await source.states.get(card.id))!,
    session: await startSession(source, "", 15),
    rating: "good",
    qualification: {
      original: true,
      attempted: true,
      assisted: false,
      contaminated: false,
    },
    durationMs: 3000,
    contentVersion: bundle.notes[0].version,
    eventId: id(),
  });
  await restoreLibrary(target, await exportLibrary(source));
  await send(bob, target);
  const page = await pull(bob, 0, 100);
  expect(page.changes.find((c) => c.entity === "reviews")?.value).toMatchObject(
    { id: event.id },
  );
  expect(
    page.changes.find((c) => c.entity === "states" && c.entityId === card.id)
      ?.value,
  ).toMatchObject({ version: 1, head: event.id });
});
it("copies a guest snapshot and its outbox atomically and retries without duplicating events", async () => {
  const guest = local(),
    account = local();
  await commitImport(guest, await demoBundle());
  const pending = await guest.outbox.toArray();
  const marker = await copyGuest(guest, account);
  expect(await account.cards.count()).toBe(6);
  expect(await account.outbox.toArray()).toEqual(pending);
  await account.outbox.delete(pending[0].id);
  await copyGuest(guest, account);
  expect(await account.outbox.count()).toBe(pending.length - 1);
  expect((await account.meta.get(marker))?.value).toBe("local-copy");
  expect(await guest.cards.count()).toBe(6);
});
it("rejects malformed snapshots, changed medical approvals, and cross-owner references", async () => {
  const bad: Mutation = {
    id: id(),
    entity: "states",
    entityId: id(),
    kind: "put",
    baseVersion: 0,
    at: new Date().toISOString(),
    value: { id: "wrong", memory: {} },
  };
  expect(
    (await push(alice, { schemaVersion: 1, mutations: [bad] })).results[0]
      .status,
  ).toBe("error");
  const device = local(),
    bundle = await demoBundle();
  await commitImport(device, bundle);
  await send(alice, device);
  const generated = (
    await new FixtureProvider().generate(bundle.notes, "recall")
  ).activity!;
  const approved = {
    ...generated,
    status: "human_approved",
    reviewerId: bob,
    approvedHash: "forged",
  };
  const mutation: Mutation = {
    id: id(),
    entity: "activities",
    entityId: approved.id,
    kind: "put",
    baseVersion: 0,
    at: new Date().toISOString(),
    value: approved,
  };
  expect(
    (await push(alice, { schemaVersion: 1, mutations: [mutation] })).results[0]
      .status,
  ).toBe("error");
  await holder.db!.query(
    "INSERT INTO documents(owner_id,entity,id,value) VALUES($1,'activities',$2,$3)",
    [alice, approved.id, JSON.stringify(approved)],
  );
  expect(
    (
      await push(alice, {
        schemaVersion: 1,
        mutations: [
          {
            ...mutation,
            id: id(),
            value: { ...approved, stem: "Changed under the same approval" },
          },
        ],
      })
    ).results[0].status,
  ).toBe("error");
  const foreign = { ...bundle.notes[0], id: id() };
  expect(
    (
      await push(bob, {
        schemaVersion: 1,
        mutations: [
          {
            ...mutation,
            id: id(),
            entity: "notes",
            entityId: foreign.id,
            value: foreign,
          },
        ],
      })
    ).results[0].status,
  ).toBe("error");
});
