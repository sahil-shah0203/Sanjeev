import type { Note, NoteType } from "@recall/domain";
import { Library } from "../lib/db/local";
import { looksLikeSvg, safeSvg } from "../../../packages/card-renderer/src/svg";
type Prepared = {
  identity: string;
  signature: string;
  urls: Map<string, string>;
  refs: number;
};
const cache = new Map<string, Prepared>();
const inFlight = new Map<string, Promise<Prepared>>();
const identity = (db: Library, note: Note, type: NoteType) =>
  `${db.name}:${note.id}:${note.version}:${type.id}`;
export function mediaNames(note: Note, type: NoteType) {
  const text = [
    ...note.fields,
    ...type.templates.flatMap((template) => [template.front, template.back]),
  ].join(" ");
  const names = new Set<string>();
  for (const match of text.matchAll(
    /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>]+))|\[sound:([^\]]+)\]/gi,
  )) {
    let name = (match[1] ?? match[2] ?? match[3] ?? match[4]).replace(
      /&amp;/g,
      "&",
    );
    try {
      name = decodeURIComponent(name);
    } catch {}
    names.add(name);
  }
  return [...names];
}
function trim() {
  for (const [key, entry] of cache) {
    if (cache.size <= 8) break;
    if (entry.refs) continue;
    cache.delete(key);
    for (const url of entry.urls.values()) URL.revokeObjectURL(url);
  }
}
export function peekCardMedia(db: Library, note: Note, type: NoteType) {
  return [...cache.values()]
    .reverse()
    .find((entry) => entry.identity === identity(db, note, type));
}
export function retainCardMedia(urls: Map<string, string>) {
  const entry = [...cache.values()].find((entry) => entry.urls === urls);
  if (entry) entry.refs++;
  return () => {
    if (entry) entry.refs--;
    trim();
  };
}
/** Prepares only local media. Current card stays visible until this finishes. */
export async function prepareCardMedia(
  db: Library,
  note: Note,
  type: NoteType,
): Promise<Prepared> {
  const names = mediaNames(note, type);
  const assets = names.length
    ? await db.media
        .where("[namespace+name]")
        .anyOf(names.map((name) => [note.namespace, name]))
        .toArray()
    : [];
  const signature = assets
    .map((asset) => `${asset.namespace}/${asset.name}/${asset.hash}`)
    .join("\n");
  const source = identity(db, note, type),
    key = `${source}:${signature}`;
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const preparing = (async () => {
    const urls = new Map<string, string>();
    for (const asset of assets) {
      if (!/^(?:image|audio|video)\//.test(asset.mime)) continue;
      let blob = asset.blob;
      if (
        asset.mime === "image/svg+xml" ||
        /\.svg$/i.test(asset.name) ||
        looksLikeSvg(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()))
      ) {
        try {
          if (blob.size > 1024 * 1024) continue;
          blob = new Blob([safeSvg(await blob.text())], {
            type: "image/svg+xml",
          });
        } catch {
          continue;
        }
      }
      const url = URL.createObjectURL(blob);
      if (asset.mime.startsWith("image/")) {
        try {
          const image = new Image();
          image.src = url;
          await image.decode();
        } catch {
          // Preloading is best-effort. A transient decode failure must not
          // erase an existing local asset or cache it as permanently missing.
          // The actual image/mask renderer performs its own decode and safety
          // checks before displaying any occluded content.
        }
      }
      urls.set(asset.name, url);
    }
    const entry = { identity: source, signature, urls, refs: 0 };
    cache.set(key, entry);
    trim();
    return entry;
  })();
  inFlight.set(key, preparing);
  try {
    return await preparing;
  } finally {
    inFlight.delete(key);
  }
}
