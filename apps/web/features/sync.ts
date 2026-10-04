import {
  id,
  now,
  type Change,
  type Mutation,
  type ReviewEvent,
  type MediaAsset,
  type Entity,
} from "@recall/domain";
import { copyGuest } from "./claim";
import { mutationOrder } from "@recall/sync";
import { Library, syncEntities, serializeEntity } from "../lib/db/local";
class LocalChangesDuringPull extends Error {}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error?.message ?? "Sync could not complete.");
  return data;
}
async function syncMedia(db: Library) {
  const committed = new Set(
    (await db.imports.filter((r) => r.status === "completed").toArray()).map(
      (r) => r.namespace,
    ),
  );
  const pending = await db.media
    .filter((m) => !m.cloud && committed.has(m.namespace))
    .toArray();
  for (const m of pending) {
    const ticket = await request("/api/media/upload", {
      method: "POST",
      body: JSON.stringify({
        id: m.id,
        hash: m.hash,
        size: m.size,
        mime: m.mime,
        name: m.name,
        namespace: m.namespace,
      }),
    });
    if (ticket.url) {
      const upload = await fetch(ticket.url, {
        method: "PUT",
        headers: { "Content-Type": m.mime },
        body: m.blob,
      });
      if (!upload.ok)
        throw new Error("A media upload failed. Retry sync to resume.");
      await request("/api/media/complete", {
        method: "POST",
        body: JSON.stringify({ id: m.id }),
      });
    }
    await db.media.update(m.id, { cloud: true });
  }
  let cursor = "";
  do {
    const page = await request(
      `/api/media/list?cursor=${encodeURIComponent(cursor)}`,
    );
    for (const m of page.assets as Omit<MediaAsset, "blob">[]) {
      if (await db.media.get(m.id)) continue;
      const ticket = await request("/api/media/download", {
        method: "POST",
        body: JSON.stringify({ id: m.id }),
      });
      const response = await fetch(ticket.url);
      if (!response.ok) throw new Error("Some media is still downloading.");
      const blob = await response.blob();
      const { hash } = await import("@recall/domain");
      if ((await hash(await blob.arrayBuffer())) !== m.hash)
        throw new Error("Downloaded media failed its integrity check.");
      await db.media.put({ ...m, blob, cloud: true });
    }
    cursor = page.nextCursor ?? "";
  } while (cursor);
}
async function runSync(db: Library, status: (s: string) => void) {
  if (!navigator.onLine) {
    status("Offline · saved here");
    return;
  }
  status("Syncing…");
  let conflicts = 0;
  // All pending local reviews are acknowledged before canonical states are pulled.
  while (true) {
    const waiting = (await db.outbox.toArray()).sort(mutationOrder);
    const batch: Mutation[] = [];
    let bytes = 0;
    for (const m of waiting) {
      const size = new TextEncoder().encode(JSON.stringify(m)).length;
      if (size > 1900000)
        throw new Error(
          "A source record is too large for cloud sync. Keep a native backup and use a smaller export.",
        );
      if (batch.length >= 50 || bytes + size > 1900000) break;
      batch.push(m);
      bytes += size;
    }
    if (!batch.length) break;
    const result = await request("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ schemaVersion: 1, mutations: batch }),
    });
    let acknowledged = 0;
    for (const receipt of result.results) {
      if (receipt.status === "error")
        throw new Error(
          receipt.message ??
            "A change needs attention before sync can continue.",
        );
      await db.transaction("rw", db.outbox, db.meta, async () => {
        await db.outbox.delete(receipt.id);
        if (receipt.conflict) {
          conflicts++;
          await db.meta.put({ id: `conflict:${receipt.id}`, value: receipt });
        }
      });
      acknowledged++;
    }
    if (!acknowledged) throw new Error("Sync did not acknowledge changes.");
  }
  let cursor = Number((await db.meta.get("cursor"))?.value ?? 0);
  while (true) {
    const page = await request(`/api/sync/pull?cursor=${cursor}&limit=100`);
    await db.transaction(
      "rw",
      [...syncEntities.map((t) => db.table(t)), db.reviews, db.meta, db.outbox],
      async () => {
        if (await db.outbox.count())
          throw new LocalChangesDuringPull(
            "New local work is saved. Sync will resume on the next pass.",
          );
        for (const change of page.changes as Change[]) {
          if (change.deleted)
            await db.table(change.entity).delete(change.entityId);
          else {
            const existing = await db.table(change.entity).get(change.entityId);
            const incoming =
              change.entity === "imports" && existing?.originalPackage
                ? {
                    ...(change.value as object),
                    originalPackage: existing.originalPackage,
                  }
                : change.value;
            await db.table(change.entity).put(incoming);
          }
          await db.meta.put({
            id: `version:${change.entity}:${change.entityId}`,
            value: change.version,
          });
        }
        cursor = page.nextCursor;
        await db.meta.put({ id: "cursor", value: cursor });
      },
    );
    if (!page.hasMore) break;
  }
  await syncMedia(db);
  const remaining = await db.outbox.count();
  status(
    conflicts
      ? "Sync complete · conflicts preserved"
      : remaining
        ? "Saved here · changes waiting"
        : "Synced across your devices",
  );
}
const active = new Map<string, Promise<void>>();
export function syncLibrary(db: Library, status: (s: string) => void) {
  const pending = active.get(db.name);
  if (pending) return pending;
  const run = async () => {
    // Guest claim or a review can add an outbox entry while a pull is in
    // flight. Push that work before trying the pull again, without an error UI.
    for (let pass = 0; pass < 3; pass++) {
      try {
        await runSync(db, status);
        return;
      } catch (error) {
        if (!(error instanceof LocalChangesDuringPull)) throw error;
      }
    }
    status("Saved here · changes waiting for the next sync");
  };
  const promise = (
    navigator.locks
      ? navigator.locks.request(`recall-sync-${db.owner}`, run)
      : run()
  ).finally(() => active.delete(db.name));
  active.set(db.name, promise);
  return promise;
}
export async function claimGuest(target: Library) {
  const owner = localStorage.getItem("recall-guest");
  if (!owner || owner === target.owner) return;
  const guest = new Library(owner);
  try {
    const marker = await copyGuest(guest, target);
    if ((await target.meta.get(marker))?.value === "complete") return;
    await syncLibrary(target, () => {});
    if (!navigator.onLine || (await target.outbox.count()))
      throw new Error(
        "Guest copy is saved locally. Reconnect and retry to finish the transfer.",
      );
    await target.meta.put({ id: marker, value: "complete" });
  } finally {
    guest.close();
  }
}
