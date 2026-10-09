import { hash, type MediaAsset } from "@recall/domain";
import type { Library } from "../lib/db/local";
const pending = new Map<string, Promise<number>>();
/** Repairs missing local bytes without touching notes, reviews, or schedules. */
export function recoverCardMedia(
  db: Library,
  namespace: string,
  names: string[],
): Promise<number> {
  const key = `${db.name}:${namespace}:${[...names].sort().join("\n")}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const work = (async () => {
    let recovered = 0;
    for (let offset = 0; offset < names.length; offset += 32) {
      const response = await fetch("/api/media/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          namespace,
          names: names.slice(offset, offset + 32),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error?.message ??
            "Images could not be recovered. Your study progress is saved.",
        );
      const downloaded: MediaAsset[] = [];
      const assets = result.assets as (Omit<MediaAsset, "blob"> & {
        url: string;
      })[];
      for (let position = 0; position < assets.length; position += 3) {
        const batch = await Promise.all(
          assets.slice(position, position + 3).map(async (asset) => {
            if (
              asset.namespace !== namespace ||
              !names.includes(asset.name) ||
              asset.size > 64 * 1024 ** 2
            )
              throw new Error("Invalid media recovery response.");
            const download = await fetch(asset.url);
            if (!download.ok)
              throw new Error(
                "Image download failed. Your progress is saved; retry when online.",
              );
            const bytes = await download.arrayBuffer();
            if (
              bytes.byteLength !== asset.size ||
              (await hash(bytes)) !== asset.hash
            )
              throw new Error("Image recovery failed its integrity check.");
            const { url, ...metadata } = asset;
            return {
              ...metadata,
              blob: new Blob([bytes], { type: asset.mime }),
            };
          }),
        );
        downloaded.push(...batch);
      }
      // Publish once so one download does not tear down another image's URLs.
      await db.transaction("rw", db.media, async () => {
        for (const asset of downloaded) {
          const local = await db.media
            .where("[namespace+name]")
            .equals([namespace, asset.name])
            .first();
          if (local?.blob?.size === asset.size && local.hash === asset.hash)
            continue;
          if (local && local.hash !== asset.hash)
            throw new Error("A local image conflict needs review.");
          await db.media.put({
            ...asset,
            id: local?.id ?? asset.id,
          });
          recovered++;
        }
      });
    }
    return recovered;
  })();
  pending.set(key, work);
  void work.finally(() => pending.delete(key)).catch(() => {});
  return work;
}
