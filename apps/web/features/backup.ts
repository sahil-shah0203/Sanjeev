import { nativeBackup, readBackup, type BackupData } from "@recall/exporter";
import { type ImportReport, now, id } from "@recall/domain";
import { Library, syncEntities, serializeEntity } from "../lib/db/local";
export async function exportLibrary(db: Library) {
  const tables: Record<string, unknown[]> = {};
  const names = [...syncEntities, "reviews"];
  let media: BackupData["media"] = [],
    originals: BackupData["originals"] = [];
  await db.transaction(
    "r",
    [...names.map((t) => db.table(t)), db.media, db.meta, db.outbox],
    async () => {
      for (const name of names)
        tables[name] = (await db.table(name).toArray()).map((v) =>
          serializeEntity(name, v),
        );
      // Preserve unresolved proposals as recovery data, not as replayable work.
      tables.meta = (await db.meta.toArray()).filter(
        (m) =>
          m.id.startsWith("conflict:") || m.id.startsWith("claim-conflict:"),
      );
      tables.meta.push({
        id: "recovery:pending",
        value: await db.outbox.toArray(),
      });
      media = await db.media.toArray();
      originals = (await db.imports.toArray())
        .filter((x) => x.originalPackage)
        .map((x) => ({ id: x.id, blob: x.originalPackage! }));
    },
  );
  return nativeBackup({ tables, media, originals });
}
export async function restoreLibrary(db: Library, file: Blob) {
  const data = await readBackup(file);
  if ((await db.cards.count()) || (await db.imports.count()))
    throw new Error(
      "Restore requires an empty library so existing progress cannot be overwritten. Export your current library first, then clear it in Settings.",
    );
  const restoreAt = now();
  await db.transaction(
    "rw",
    [
      ...Object.keys(data.tables).map((t) => db.table(t)),
      db.media,
      db.outbox,
      db.meta,
    ],
    async () => {
      if (await db.cards.count())
        throw new Error("Another tab added cards. Restore stopped safely.");
      for (const [name, values] of Object.entries(data.tables)) {
        const rows = values.map((v) => {
          if (name === "activities" && (v as any).status === "human_approved")
            return { ...(v as object), status: "quarantined" };
          if (name === "imports") {
            const r = v as ImportReport;
            return {
              ...r,
              originalPackage: data.originals.find((x) => x.id === r.id)?.blob,
            };
          }
          return v;
        });
        await db.table(name).bulkPut(rows);
        if (name === "meta") continue;
        await db.outbox.bulkPut(
          rows.map((value: any) => ({
            id: id(),
            kind: (name === "reviews" || name === "undos"
              ? "archive"
              : "put") as "archive" | "put",
            entity: name as any,
            entityId: value.id,
            value: serializeEntity(name, value),
            baseVersion: 0,
            at: restoreAt,
          })),
        );
      }
      await db.media.bulkPut(data.media);
      const maximum = (data.tables.reviews ?? []).reduce<number>(
        (maximum, r: any) => Math.max(maximum, r.sequence),
        0,
      );
      await db.meta.put({ id: "sequence", value: maximum });
    },
  );
  return data;
}
export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
