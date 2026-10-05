import "fake-indexeddb/auto";
import { it, expect, vi } from "vitest";
import { Library, enqueue } from "../apps/web/lib/db/local";
import { syncLibrary } from "../apps/web/features/sync";
import { id } from "@recall/domain";
import { demoBundle } from "../apps/web/features/demo";

it("retries an in-flight pull when guest copying adds local work, preserving and acknowledging the new work", async () => {
  const db = new Library(id());
  const source = (await demoBundle()).notes[0];
  let pulls = 0,
    pushes = 0;
  const status: string[] = [];
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/sync/pull")) {
      if (++pulls === 1) {
        await db.transaction("rw", db.notes, db.meta, db.outbox, async () => {
          await db.notes.put(source);
          await enqueue(db, "notes", source.id, source);
        });
        return Response.json({
          changes: [
            {
              entity: "notes",
              entityId: source.id,
              value: { ...source, fields: ["obsolete incoming snapshot"] },
              version: 1,
            },
          ],
          nextCursor: 1,
          hasMore: false,
        });
      }
      return Response.json({ changes: [], nextCursor: 2, hasMore: false });
    }
    if (url === "/api/sync/push") {
      pushes++;
      const mutations = JSON.parse(String(init?.body)).mutations;
      expect(mutations[0].value).toEqual(source);
      return Response.json({
        results: mutations.map((m: { id: string }) => ({
          id: m.id,
          status: "ok",
        })),
      });
    }
    if (url.startsWith("/api/media/list"))
      return Response.json({ assets: [], nextCursor: "" });
    throw new Error("Unexpected request");
  });
  try {
    const sync = syncLibrary(db, (s) => status.push(s));
    expect(syncLibrary(db, () => {})).toBe(sync);
    await sync;
    expect(pulls).toBe(2);
    expect(pushes).toBe(1);
    expect(await db.notes.get(source.id)).toEqual(source);
    expect(await db.outbox.count()).toBe(0);
    expect(status.at(-1)).toBe("Synced across your devices");
  } finally {
    await db.delete();
    vi.unstubAllGlobals();
  }
});

it("finishes sync on a new connection after navigation closes an in-flight connection", async () => {
  const owner = id();
  const previous = new Library(owner);
  const current = new Library(owner);
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  let pulls = 0;
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.startsWith("/api/sync/pull")) {
      if (++pulls === 1) {
        started();
        await blocked;
      }
      return Response.json({ changes: [], nextCursor: pulls, hasMore: false });
    }
    if (url.startsWith("/api/media/list"))
      return Response.json({ assets: [], nextCursor: "" });
    throw new Error("Unexpected request");
  });
  try {
    await previous.open();
    const oldRun = syncLibrary(previous, () => {}).catch((error) => error);
    await requested;
    previous.close();
    await current.open();
    const status: string[] = [];
    const resumed = syncLibrary(current, (s) => status.push(s));
    release();
    expect((await oldRun).name).toBe("DatabaseClosedError");
    await resumed;
    expect(pulls).toBe(2);
    expect((await current.meta.get("cursor"))?.value).toBe(2);
    expect(status.at(-1)).toBe("Synced across your devices");
  } finally {
    release();
    previous.close();
    await current.delete();
    vi.unstubAllGlobals();
  }
});
