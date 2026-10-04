import initSqlJs, { type Database } from "sql.js";
import { createRequire } from "node:module";
import {
  BlobReader,
  BlobWriter,
  ZipReader,
  ZipWriter,
  Uint8ArrayReader,
} from "@zip.js/zip.js";
import { ankiContent } from "@recall/exporter";
import { readEntry } from "@recall/importer";
import { demoBundle } from "../../apps/web/features/demo";
import { id, hash, type ImportBundle } from "@recall/domain";
export const wasmUrl = createRequire(import.meta.url).resolve(
  "sql.js/dist/sql-wasm.wasm",
);
const varint = (n: number) => {
  const b: number[] = [];
  do {
    const v = n % 128;
    n = Math.floor(n / 128);
    b.push(v | (n ? 128 : 0));
  } while (n);
  return b;
};
export const proto = (...entries: [number, number | string | Uint8Array][]) =>
  new Uint8Array(
    entries.flatMap(([field, value]) => {
      if (typeof value === "number")
        return [...varint(field * 8), ...varint(value)];
      const bytes =
        typeof value === "string" ? new TextEncoder().encode(value) : value;
      return [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];
    }),
  );
// Standards-compliant raw-block frame, so public modern fixtures need no private
// Anki export or compression dependency. Unknown-size window is 1 MiB.
export function rawZstd(bytes: Uint8Array, unknownSize = false) {
  const header = unknownSize
    ? [0x28, 0xb5, 0x2f, 0xfd, 0, 80]
    : [
        0x28,
        0xb5,
        0x2f,
        0xfd,
        0xa0,
        bytes.length & 255,
        (bytes.length >>> 8) & 255,
        (bytes.length >>> 16) & 255,
        (bytes.length >>> 24) & 255,
      ];
  const blocks: number[] = [...header];
  for (let offset = 0; offset < bytes.length || offset === 0; offset += 65536) {
    const chunk = bytes.subarray(offset, offset + 65536);
    const n =
      chunk.length * 8 + (offset + chunk.length >= bytes.length ? 1 : 0);
    blocks.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, ...chunk);
  }
  return new Uint8Array(blocks);
}
export async function syntheticBundle(): Promise<ImportBundle> {
  const bundle = await demoBundle();
  bundle.decks[0].name = "Synthetic::Unicode Ω";
  bundle.notes[0].tags = ["public::fixture", "日本語"];
  bundle.notes[0].fields[1] += '<img src="diagram.png">';
  bundle.notes[0].version = await hash(JSON.stringify(bundle.notes[0].fields));
  // Minimal authored PNG for public upload/download and rendering checks.
  const bytes = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  bundle.media.push({
    id: id(),
    namespace: bundle.report.namespace,
    name: "diagram.png",
    hash: await hash(bytes),
    mime: "image/png",
    size: bytes.length,
    blob: new Blob([bytes]),
  });
  return bundle;
}
export async function syntheticPackage(
  modern = true,
  mutate?: (db: Database) => void,
) {
  const bundle = await syntheticBundle();
  const legacy = await ankiContent(bundle, wasmUrl);
  const reader = new ZipReader(new BlobReader(legacy.blob));
  const entries = await reader.getEntries();
  const bytes = await readEntry(
    entries.find((e) => e.filename === "collection.anki2")!,
    128 * 1024 ** 2,
  );
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database(bytes);
  if (modern) {
    db.run(
      "CREATE TABLE notetypes(id integer primary key,name text,config blob); CREATE TABLE fields(ntid integer,ord integer,name text); CREATE TABLE templates(ntid integer,ord integer,name text,config blob); CREATE TABLE decks(id integer primary key,name text);",
    );
    for (const t of bundle.types) {
      db.run("INSERT INTO notetypes VALUES(?,?,?)", [
        t.originalId,
        t.name,
        proto([1, 1], [3, t.css]),
      ]);
      t.fields.forEach((f, i) =>
        db.run("INSERT INTO fields VALUES(?,?,?)", [t.originalId, i, f]),
      );
      t.templates.forEach((v) =>
        db.run("INSERT INTO templates VALUES(?,?,?,?)", [
          t.originalId,
          v.ord,
          v.name,
          proto([1, v.front], [2, v.back]),
        ]),
      );
    }
    bundle.decks.forEach((d) =>
      db.run("INSERT INTO decks VALUES(?,?)", [
        d.originalId,
        d.name.replaceAll("::", "\x1f"),
      ]),
    );
  }
  mutate?.(db);
  const writer = new ZipWriter(new BlobWriter());
  if (modern) {
    await writer.add("meta", new Uint8ArrayReader(proto([1, 3])));
    await writer.add(
      "collection.anki2",
      new Uint8ArrayReader(
        new TextEncoder().encode("compatibility placeholder"),
      ),
    );
    await writer.add(
      "collection.anki21b",
      new Uint8ArrayReader(rawZstd(db.export(), true)),
    );
    await writer.add(
      "media",
      new Uint8ArrayReader(
        rawZstd(proto([1, proto([1, "diagram.png"], [255, 7])])),
      ),
    );
    await writer.add(
      "7",
      new Uint8ArrayReader(
        rawZstd(new Uint8Array(await bundle.media[0].blob.arrayBuffer())),
      ),
    );
  } else {
    await writer.add("collection.anki2", new Uint8ArrayReader(db.export()));
    await writer.add(
      "media",
      new Uint8ArrayReader(new TextEncoder().encode('{"7":"diagram.png"}')),
    );
    await writer.add("7", new BlobReader(bundle.media[0].blob));
  }
  db.close();
  await reader.close();
  return new File(
    [await writer.close()],
    modern ? "synthetic-modern.apkg" : "synthetic-legacy.apkg",
  );
}
