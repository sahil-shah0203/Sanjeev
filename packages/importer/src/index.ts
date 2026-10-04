import { ZipReader, BlobReader, type Entry } from "@zip.js/zip.js";
import { Decompress } from "fzstd";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import {
  hash,
  id,
  now,
  type ImportBundle,
  type MediaAsset,
  type NoteType,
  type Raw,
} from "@recall/domain";
import { protobuf, protoText, protoNum } from "./protobuf";
import { compatibility, renderCard } from "@recall/card-renderer";

export const LIMITS = {
  package: 512 * 1024 ** 2,
  database: 128 * 1024 ** 2,
  member: 64 * 1024 ** 2,
  total: 2 * 1024 ** 3,
  entries: 100000,
  timeoutMs: 180000,
};
export interface ImportOptions {
  wasmUrl?: string;
  sql?: SqlJsStatic;
  progress?: (phase: string, current: number, total: number) => void;
  signal?: AbortSignal;
  onMedia?: (asset: MediaAsset) => Promise<void>;
  namespace?: string;
}
export function safeName(name: string): boolean {
  return (
    !!name &&
    !/[\\\x00-\x1f]/.test(name) &&
    !name.startsWith("/") &&
    !/^[A-Za-z]:/.test(name) &&
    !name.split("/").some((p) => p === ".." || p === ".")
  );
}
export function zstd(bytes: Uint8Array, limit: number): Uint8Array {
  if (
    bytes.length < 6 ||
    bytes[0] !== 0x28 ||
    bytes[1] !== 0xb5 ||
    bytes[2] !== 0x2f ||
    bytes[3] !== 0xfd
  )
    throw new Error("Invalid Zstandard frame.");
  // Bound the history window before the decoder allocates it, including unknown-size frames.
  if (!(bytes[4] & 32)) {
    const w = bytes[5];
    const base = 2 ** (10 + (w >>> 3));
    if (base + (base / 8) * (w & 7) > limit)
      throw new Error("Zstandard window exceeds the import limit.");
  } else {
    const flag = bytes[4] >>> 6;
    const dictFlag = bytes[4] & 3;
    const offset = 5 + [0, 1, 2, 4][dictFlag];
    const length = [1, 2, 4, 8][flag];
    if (offset + length > bytes.length)
      throw new Error("Truncated Zstandard header.");
    let size = 0n;
    for (let i = 0; i < length; i++)
      size |= BigInt(bytes[offset + i]) << BigInt(8 * i);
    if (flag === 1) size += 256n;
    if (size > BigInt(limit))
      throw new Error("Zstandard content exceeds the import limit.");
  }
  // A member must be one complete frame. Otherwise a later concatenated frame
  // could allocate an unchecked history window before the output limit fires.
  const descriptor = bytes[4];
  if (descriptor & 8) throw new Error("Reserved Zstandard frame flag.");
  const single = !!(descriptor & 32),
    flag = descriptor >>> 6;
  let cursor =
    5 +
    (single ? 0 : 1) +
    [0, 1, 2, 4][descriptor & 3] +
    (flag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][flag]);
  let last = false;
  while (!last) {
    if (cursor + 3 > bytes.length)
      throw new Error("Truncated Zstandard block.");
    const header =
      bytes[cursor] | (bytes[cursor + 1] << 8) | (bytes[cursor + 2] << 16);
    cursor += 3;
    last = !!(header & 1);
    const kind = (header >>> 1) & 3,
      length = header >>> 3;
    if (kind === 3 || length > 131072)
      throw new Error("Unsupported Zstandard block.");
    cursor += kind === 1 ? 1 : length;
    if (cursor > bytes.length)
      throw new Error("Truncated Zstandard block data.");
  }
  if (descriptor & 4) cursor += 4;
  if (cursor !== bytes.length)
    throw new Error(
      "Concatenated, truncated, or trailing Zstandard frames are unsupported.",
    );
  let size = 0;
  const chunks: Uint8Array[] = [];
  const decoder = new Decompress((chunk) => {
    size += chunk.length;
    if (size > limit) throw new Error("Decoded data exceeds the import limit.");
    chunks.push(chunk.slice());
  });
  for (let i = 0; i < bytes.length; i += 65536)
    decoder.push(bytes.subarray(i, i + 65536), i + 65536 >= bytes.length);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
export async function readEntry(
  entry: Entry,
  limit: number,
): Promise<Uint8Array> {
  if (entry.directory || !("getData" in entry) || !entry.getData)
    throw new Error("Expected an archive file.");
  if (entry.uncompressedSize > limit || entry.encrypted)
    throw new Error("Archive member is encrypted or exceeds its size limit.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  await entry.getData(
    new WritableStream<Uint8Array>({
      write(chunk) {
        size += chunk.length;
        if (size > limit)
          throw new Error("Archive expansion exceeds its limit.");
        chunks.push(chunk.slice());
      },
    }),
    { checkSignature: true, useWebWorkers: false },
  );
  const bytes = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, pos);
    pos += chunk.length;
  }
  return bytes;
}
export function detectMime(b: Uint8Array): string {
  const s = new TextDecoder("latin1").decode(b.subarray(0, 16));
  if (b[0] === 137 && s.slice(1, 4) === "PNG") return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WEBP") return "image/webp";
  if (s.startsWith("GIF87a") || s.startsWith("GIF89a")) return "image/gif";
  if (s.startsWith("ID3") || (b[0] === 255 && (b[1] & 224) === 224))
    return "audio/mpeg";
  if (s.startsWith("OggS")) return "audio/ogg";
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WAVE") return "audio/wav";
  if (s.slice(4, 8) === "ftyp") return "video/mp4";
  return "application/octet-stream";
}
export function rows(db: Database, query: string): Raw[] {
  const statement = db.prepare(query);
  const output: Raw[] = [];
  try {
    while (statement.step()) {
      const row = (
        statement.getAsObject as unknown as (
          params: undefined,
          options: { useBigInt: boolean },
        ) => Record<string, unknown>
      )(undefined, { useBigInt: true });
      output.push(
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            typeof v === "bigint" ? v.toString() : v,
          ]),
        ),
      );
    }
  } finally {
    statement.free();
  }
  return output;
}
function json(value: unknown): Record<string, any> {
  if (typeof value !== "string" || !value) return {};
  return JSON.parse(value);
}
function plainRaw(row: Raw): Raw {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      v instanceof Uint8Array ? { bytes: Array.from(v) } : v,
    ]),
  );
}
export async function parsePackage(
  file: Blob & { name?: string },
  options: ImportOptions = {},
): Promise<ImportBundle> {
  const started = Date.now();
  const check = () => {
    if (options.signal?.aborted) throw new Error("Import cancelled.");
    if (Date.now() - started > LIMITS.timeoutMs)
      throw new Error(
        "Import exceeded three minutes. Export a smaller selected deck.",
      );
  };
  if (file.size > LIMITS.package)
    throw new Error(
      "This package exceeds the 512 MiB browser limit. Export a smaller selected deck.",
    );
  options.progress?.("Inspecting archive", 0, 1);
  const packageHash = await hash(await file.arrayBuffer());
  check();
  const namespace = options.namespace ?? id(),
    importId = id();
  const zip = new ZipReader(new BlobReader(file));
  let db: Database | undefined;
  try {
    const entries = new Map<string, Entry>();
    let outerSize = 0;
    for await (const entry of zip.getEntriesGenerator()) {
      check();
      if (
        !safeName(entry.filename) ||
        entries.has(entry.filename) ||
        entry.encrypted
      )
        throw new Error("Unsafe, duplicate, or encrypted archive entry.");
      outerSize += entry.uncompressedSize;
      if (entries.size >= LIMITS.entries || outerSize > LIMITS.total)
        throw new Error("Archive exceeds the member or total size limit.");
      entries.set(entry.filename, entry);
    }
    const read = async (name: string, limit: number) => {
      const e = entries.get(name);
      if (!e) throw new Error(`Required archive member is missing: ${name}`);
      check();
      return readEntry(e, limit);
    };
    let modern = false,
      dbName = "";
    if (entries.has("meta")) {
      const version = protoNum(protobuf(await read("meta", 1024)), 1);
      if (version !== 3)
        throw new Error(
          `Unsupported Anki package version ${version}. Export in a supported format.`,
        );
      modern = true;
      dbName = "collection.anki21b";
    } else
      dbName = entries.has("collection.anki21")
        ? "collection.anki21"
        : "collection.anki2";
    options.progress?.("Reading collection", 0, 1);
    const packed = await read(dbName, LIMITS.database);
    const bytes = modern ? zstd(packed, LIMITS.database) : packed;
    if (new TextDecoder().decode(bytes.subarray(0, 16)) !== "SQLite format 3\0")
      throw new Error(
        "The selected collection is not a valid SQLite database.",
      );
    const SQL =
      options.sql ??
      (await initSqlJs({
        locateFile: () => options.wasmUrl ?? "/wasm/sql-wasm.wasm",
      }));
    db = new SQL.Database(bytes);
    db.run("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;");
    const tables = new Set(
      rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) =>
        String(r.name),
      ),
    );
    for (const t of ["col", "notes", "cards", "revlog"])
      if (!tables.has(t))
        throw new Error(`Unsupported collection schema: missing ${t}.`);
    const collection = rows(db, "SELECT * FROM col LIMIT 1")[0] ?? {};
    const warnings: string[] = [],
      types: NoteType[] = [];
    const typeMap = new Map<string, string>();
    const deckMap = new Map<string, string>();
    if (tables.has("notetypes")) {
      for (const n of rows(db, "SELECT * FROM notetypes ORDER BY id")) {
        const typeId = id(),
          originalId = String(n.id);
        typeMap.set(originalId, typeId);
        const config = protobuf(n.config as Uint8Array);
        const fields = rows(
          db,
          `SELECT * FROM fields WHERE ntid = ${BigInt(originalId)} ORDER BY ord`,
        ).map((x) => String(x.name));
        const templates = rows(
          db,
          `SELECT * FROM templates WHERE ntid = ${BigInt(originalId)} ORDER BY ord`,
        ).map((t) => {
          const c = protobuf(t.config as Uint8Array);
          return {
            name: String(t.name),
            ord: Number(t.ord),
            front: protoText(c, 1),
            back: protoText(c, 2),
          };
        });
        types.push({
          id: typeId,
          originalId,
          name: String(n.name),
          kind:
            protoNum(config, 9) === 6
              ? "occlusion"
              : protoNum(config, 1) === 1
                ? "cloze"
                : "basic",
          fields,
          templates,
          css: protoText(config, 3),
          raw: plainRaw(n),
        });
      }
    } else {
      for (const n of Object.values(json(collection.models))) {
        const typeId = id(),
          originalId = String(n.id);
        typeMap.set(originalId, typeId);
        types.push({
          id: typeId,
          originalId,
          name: n.name,
          kind: Number(n.type) === 1 ? "cloze" : "basic",
          fields: [...n.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
          templates: n.tmpls.map((t: any) => ({
            name: t.name,
            ord: t.ord,
            front: t.qfmt,
            back: t.afmt,
          })),
          css: n.css ?? "",
          raw: n,
        });
      }
    }
    const sourceDecks = tables.has("decks")
      ? rows(db, "SELECT * FROM decks ORDER BY id")
      : Object.values(json(collection.decks));
    const decks = sourceDecks.map((d) => {
      const deckId = id();
      deckMap.set(String(d.id), deckId);
      return {
        id: deckId,
        namespace,
        originalId: String(d.id),
        name: String(d.name).replace(/\x1f/g, "::"),
        importId,
      };
    });
    const noteMap = new Map<string, string>();
    const notes = await Promise.all(
      rows(db, "SELECT * FROM notes ORDER BY id").map(async (n) => {
        const noteId = id();
        noteMap.set(String(n.id), noteId);
        const typeId = typeMap.get(String(n.mid));
        if (!typeId)
          throw new Error(
            `Missing note type for note ${n.id}. Original package remains unchanged.`,
          );
        const fields = String(n.flds).split("\x1f");
        return {
          id: noteId,
          namespace,
          originalId: String(n.id),
          guid: String(n.guid),
          typeId,
          fields,
          tags: String(n.tags).trim().split(/\s+/).filter(Boolean),
          version: await hash(JSON.stringify(fields)),
          raw: plainRaw(n),
          revisions: [],
        };
      }),
    );
    const notesById = new Map(notes.map((n) => [n.id, n]));
    const typesById = new Map(types.map((t) => [t.id, t]));
    const cards = rows(db, "SELECT * FROM cards ORDER BY id").map((c) => {
      const noteId = noteMap.get(String(c.nid)),
        deckId = deckMap.get(String(c.did));
      if (!noteId || !deckId)
        throw new Error(`Card ${c.id} has a missing note or deck.`);
      const note = notesById.get(noteId)!;
      const type = typesById.get(note.typeId)!;
      const support = compatibility(type, note, Number(c.ord));
      return {
        id: id(),
        namespace,
        originalId: String(c.id),
        noteId,
        deckId,
        ord: Number(c.ord),
        supported: support.supported,
        reason: support.reason,
        suspended: Number(c.queue) === -1,
        flagged: Number(c.flags) > 0,
        raw: plainRaw(c),
      };
    });
    const history = rows(db, "SELECT * FROM revlog ORDER BY id").map(plainRaw);
    const historyCount = history.length;
    if (historyCount || cards.some((c) => Number(c.raw.reps) > 0))
      warnings.push(
        "Scheduling data is preserved. Personal progress migration requires an explicit choice; unsupported memory states are never guessed.",
      );
    if (cards.some((c) => Number(c.raw.queue) < -1))
      warnings.push(
        "Anki buried cards are imported as available; suspension is preserved. Review their availability in Browse.",
      );
    const media: MediaAsset[] = [];
    const names = new Set<string>(),
      folded = new Set<string>();
    let totalDecoded = bytes.length;
    let mediaMap: { name: string; index: string }[] = [];
    if (entries.has("media")) {
      const mapBytes = await read("media", LIMITS.member);
      if (modern) {
        const m = protobuf(zstd(mapBytes, LIMITS.member));
        mediaMap = (m.get(1) ?? []).map((v, i) => {
          if (!(v instanceof Uint8Array))
            throw new Error("Invalid media entry.");
          const m = protobuf(v);
          return {
            name: protoText(m, 1),
            index: String(m.has(255) ? protoNum(m, 255) : i),
          };
        });
      } else
        mediaMap = Object.entries(json(new TextDecoder().decode(mapBytes))).map(
          ([index, name]) => ({ index, name: String(name) }),
        );
    }
    const missingMedia: string[] = [];
    for (let i = 0; i < mediaMap.length; i++) {
      check();
      const { name, index } = mediaMap[i];
      if (!safeName(name) || !/^\d+$/.test(index) || names.has(name))
        throw new Error("Unsafe or duplicate media filename.");
      names.add(name);
      const key = name.normalize("NFC").toLowerCase();
      if (folded.has(key))
        warnings.push(`Case or Unicode media collision preserved: ${name}`);
      folded.add(key);
      options.progress?.("Reading media", i + 1, mediaMap.length);
      if (!entries.has(index)) {
        missingMedia.push(name);
        continue;
      }
      const packed = await read(index, LIMITS.member);
      const data = modern ? zstd(packed, LIMITS.member) : packed;
      totalDecoded += data.length;
      if (totalDecoded > LIMITS.total)
        throw new Error("Decoded collection exceeds the total limit.");
      const mime = detectMime(data);
      if (mime === "application/octet-stream")
        warnings.push(`Media is preserved but not displayed: ${name}`);
      const asset: MediaAsset = {
        id: id(),
        namespace,
        name,
        hash: await hash(data),
        mime,
        size: data.length,
        blob: new Blob([data as BlobPart], { type: mime }),
      };
      if (options.onMedia) await options.onMedia(asset);
      else media.push(asset);
    }
    for (const field of [
      ...notes.flatMap((n) => n.fields),
      ...types.flatMap((t) => t.templates.flatMap((v) => [v.front, v.back])),
    ]) {
      const regex =
        /<(?:img|audio|source|video)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']|\[sound:([^\]]+)\]/gi;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(field))) {
        let name = (match[1] ?? match[2]).replace(/&amp;/g, "&");
        try {
          name = decodeURIComponent(name);
        } catch {}
        if (
          !/^(?:https?:|data:|blob:)/i.test(name) &&
          !names.has(name) &&
          !missingMedia.includes(name)
        )
          missingMedia.push(name);
      }
    }
    for (const c of cards) {
      const n = notesById.get(c.noteId)!;
      const t = typesById.get(n.typeId)!;
      if (!c.supported) continue;
      const questionFields =
        t.kind === "occlusion"
          ? [n.fields[1]]
          : [renderCard(t, n, c.ord, false).html];
      if (
        questionFields.some((f) => missingMedia.some((m) => f?.includes(m)))
      ) {
        c.supported = false;
        c.reason = "A question image or audio file is missing.";
      }
    }
    if (
      types.some((t) =>
        /<script\b/i.test(t.templates.map((x) => x.front + x.back).join("")),
      )
    )
      warnings.push(
        "Deck scripts are not executed. Supported AnKing cards use a native layout.",
      );
    return {
      report: {
        id: importId,
        namespace,
        hash: packageHash,
        filename: file.name ?? "collection.apkg",
        bytes: file.size,
        format: modern ? "Anki v3" : dbName,
        parserVersion: "recall-import-1",
        createdAt: now(),
        status: "staged",
        notes: notes.length,
        cards: cards.length,
        ready: cards.filter((c) => c.supported).length,
        media:
          mediaMap.length - missingMedia.filter((n) => names.has(n)).length,
        missingMedia,
        warnings: [...new Set(warnings)],
        historyCount,
        rawCollection: plainRaw(collection),
        history,
        historyMode: "fresh",
        originalPackage: file,
      },
      decks,
      types,
      notes,
      cards,
      media,
    };
  } finally {
    db?.close();
    await zip.close();
  }
}
