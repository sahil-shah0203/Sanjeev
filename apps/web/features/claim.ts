import {
  id,
  now,
  stableJson,
  type Mutation,
  type MediaAsset,
} from "@recall/domain";
import { Library, syncEntities, serializeEntity } from "../lib/db/local";

/** Copy a consistent guest snapshot and its stable mutation IDs in one target transaction. */
export async function copyGuest(guest: Library, target: Library) {
  const marker = `claim:${guest.owner}`;
  if (await target.meta.get(marker)) return marker;
  const names = [...syncEntities, "reviews"];
  const source: Record<string, any[]> = {};
  let media: MediaAsset[] = [],
    pending: Mutation[] = [];
  await guest.transaction(
    "r",
    [...names.map((t) => guest.table(t)), guest.media, guest.outbox],
    async () => {
      for (const name of names)
        source[name] = await guest.table(name).toArray();
      media = await guest.media.toArray();
      pending = await guest.outbox.toArray();
    },
  );
  const at = now();
  await target.transaction(
    "rw",
    [
      ...names.map((t) => target.table(t)),
      target.media,
      target.outbox,
      target.meta,
    ],
    async () => {
      if (await target.meta.get(marker)) return;
      const copied = new Set<string>();
      for (const name of names)
        for (const row of source[name]) {
          const existing = await target.table(name).get(row.id);
          if (existing) {
            if (
              stableJson(serializeEntity(name, existing)) !==
              stableJson(serializeEntity(name, row))
            )
              await target.meta.put({
                id: `claim-conflict:${name}:${row.id}`,
                value: {
                  guest: serializeEntity(name, row),
                  account: serializeEntity(name, existing),
                },
              });
            continue;
          }
          await target.table(name).put(row);
          copied.add(`${name}:${row.id}`);
        }
      for (const asset of media)
        if (!(await target.media.get(asset.id)))
          await target.media.put({ ...asset, cloud: false });
      if (pending.length) {
        for (const mutation of pending) {
          // A preferences collision is a deliberate account choice. Source and review
          // conflicts go through the server reconciler and keep an audit receipt.
          if (
            mutation.entity === "preferences" &&
            !copied.has("preferences:preferences")
          )
            continue;
          if (!(await target.outbox.get(mutation.id)))
            await target.outbox.put(mutation);
        }
      } else
        for (const name of names)
          for (const row of source[name])
            if (copied.has(`${name}:${row.id}`))
              await target.outbox.put({
                id: id(),
                kind:
                  name === "reviews" || name === "undos" ? "archive" : "put",
                entity: name as Mutation["entity"],
                entityId: row.id,
                value: serializeEntity(name, row),
                baseVersion: 0,
                at,
              });
      await target.meta.put({ id: marker, value: "local-copy" });
    },
  );
  return marker;
}
