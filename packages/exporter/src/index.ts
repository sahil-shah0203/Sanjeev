import {
  ZipWriter,
  ZipReader,
  BlobWriter,
  BlobReader,
  TextReader,
  Uint8ArrayReader,
} from "@zip.js/zip.js";
import initSqlJs from "sql.js";
import {
  hash,
  validateRecord,
  SCHEMA_VERSION,
  type ImportBundle,
  type ImportReport,
  type MediaAsset,
  type Raw,
} from "@recall/domain";
import { LIMITS, readEntry, safeName } from "@recall/importer";

export interface BackupData {
  tables: Record<string, unknown[]>;
  media: MediaAsset[];
  originals: { id: string; blob: Blob }[];
}
export async function nativeBackup(data: BackupData): Promise<Blob> {
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  const checksums: Record<string, string> = {};
  const content = JSON.stringify({
    tables: data.tables,
    media: data.media.map(({ blob, ...m }) => m),
    originals: data.originals.map((x) => x.id),
  });
  checksums["library.json"] = await hash(content);
  await zip.add("library.json", new TextReader(content));
  for (const asset of data.media) {
    const path = `media/${asset.id}`;
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    checksums[path] = await hash(bytes);
    await zip.add(path, new Uint8ArrayReader(bytes));
  }
  for (const original of data.originals) {
    const path = `originals/${original.id}`;
    checksums[path] = await hash(await original.blob.arrayBuffer());
    await zip.add(path, new BlobReader(original.blob));
  }
  await zip.add(
    "manifest.json",
    new TextReader(
      JSON.stringify({
        format: "recall-native",
        schemaVersion: SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        checksums,
      }),
    ),
  );
  return zip.close();
}
const tablesAllowed = [
  "imports",
  "decks",
  "types",
  "notes",
  "cards",
  "states",
  "reviews",
  "exposures",
  "sessions",
  "activities",
  "attempts",
  "reports",
  "preferences",
  "undos",
  "meta",
];
export async function readBackup(file: Blob): Promise<BackupData> {
  if (file.size > LIMITS.total)
    throw new Error("Backup exceeds the 2 GiB restore limit.");
  const zip = new ZipReader(new BlobReader(file));
  try {
    const entries = new Map();
    let total = 0;
    for await (const entry of zip.getEntriesGenerator()) {
      if (
        !safeName(entry.filename) ||
        entries.has(entry.filename) ||
        entries.size >= LIMITS.entries
      )
        throw new Error("Unsafe or duplicate backup entry.");
      total += entry.uncompressedSize;
      if (total > LIMITS.total)
        throw new Error("Backup expands beyond the restore limit.");
      entries.set(entry.filename, entry);
    }
    const read = async (path: string, limit: number) => {
      if (!entries.has(path)) throw new Error(`Backup is missing ${path}.`);
      return readEntry(entries.get(path), limit);
    };
    const manifest = JSON.parse(
      new TextDecoder().decode(await read("manifest.json", 16 * 1024 ** 2)),
    );
    if (
      manifest.format !== "recall-native" ||
      manifest.schemaVersion !== SCHEMA_VERSION
    )
      throw new Error(
        "Unsupported backup version. Use a compatible Recall release.",
      );
    const checked = async (path: string, limit: number) => {
      const bytes = await read(path, limit);
      if ((await hash(bytes)) !== manifest.checksums[path])
        throw new Error(
          `Backup checksum failed for ${path}. Nothing has been restored.`,
        );
      return bytes;
    };
    const raw = JSON.parse(
      new TextDecoder().decode(await checked("library.json", LIMITS.database)),
    );
    if (
      !raw.tables ||
      !Array.isArray(raw.media) ||
      !Array.isArray(raw.originals)
    )
      throw new Error("Invalid backup manifest.");
    for (const [table, values] of Object.entries(raw.tables)) {
      if (!tablesAllowed.includes(table) || !Array.isArray(values))
        throw new Error("Unknown backup table.");
      const ids = new Set<string>();
      for (const row of values) {
        if (!row || typeof row.id !== "string" || ids.has(row.id))
          throw new Error("Invalid or duplicate backup record.");
        if (table === "meta") {
          if (!/^(conflict:|claim-conflict:|recovery:pending$)/.test(row.id))
            throw new Error("Unsupported recovery metadata.");
        } else validateRecord(table, row);
        ids.add(row.id);
      }
    }
    const media: MediaAsset[] = [];
    for (const m of raw.media) {
      if (typeof m.id !== "string" || !safeName(m.id) || m.id.includes("/"))
        throw new Error("Invalid media identifier.");
      const b = await checked(`media/${m.id}`, LIMITS.member);
      if ((await hash(b)) !== m.hash)
        throw new Error("Media content hash mismatch.");
      media.push({
        ...m,
        cloud: false,
        blob: new Blob([b as BlobPart], { type: m.mime }),
      });
    }
    const originals: { id: string; blob: Blob }[] = [];
    for (const importId of raw.originals) {
      if (
        typeof importId !== "string" ||
        !safeName(importId) ||
        importId.includes("/")
      )
        throw new Error("Invalid import identifier.");
      originals.push({
        id: importId,
        blob: new Blob([
          (await checked(`originals/${importId}`, LIMITS.package)) as BlobPart,
        ]),
      });
    }
    for (const required of tablesAllowed.filter((t) => t !== "meta"))
      if (!Array.isArray(raw.tables[required]))
        throw new Error(`Backup is missing the ${required} table.`);
    const ids = (table: string) =>
      new Set((raw.tables[table] ?? []).map((r: Raw) => r.id));
    const notes = ids("notes"),
      types = ids("types"),
      cards = ids("cards"),
      decks = ids("decks");
    if (
      (raw.tables.notes ?? []).some((n: Raw) => !types.has(n.typeId)) ||
      (raw.tables.cards ?? []).some(
        (c: Raw) => !notes.has(c.noteId) || !decks.has(c.deckId),
      ) ||
      (raw.tables.states ?? []).some((s: Raw) => !cards.has(s.id))
    )
      throw new Error("Backup contains broken source references.");
    const reviewIds = ids("reviews"),
      activityIds = ids("activities");
    if (
      (raw.tables.reviews ?? []).some(
        (r: Raw) => !cards.has(r.cardId) || !notes.has(r.noteId),
      ) ||
      (raw.tables.undos ?? []).some((u: Raw) => !reviewIds.has(u.reviewId)) ||
      (raw.tables.attempts ?? []).some(
        (a: Raw) => !activityIds.has(a.activityId),
      )
    )
      throw new Error("Backup contains broken history references.");
    return { tables: raw.tables, media, originals };
  } finally {
    await zip.close();
  }
}
export async function ankiContent(
  bundle: ImportBundle,
  wasmUrl = "/wasm/sql-wasm.wasm",
): Promise<{ blob: Blob; report: string[] }> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database();
  const report = [
    "Content-only export: Recall schedules, review logs, and adaptive evidence are not imported into Anki. Use a native backup to preserve all progress.",
  ];
  try {
    db.run(
      "CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null); CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null); CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null); CREATE TABLE revlog (id integer primary key,cid integer not null,usn integer not null,ease integer not null,ivl integer not null,lastIvl integer not null,factor integer not null,time integer not null,type integer not null); CREATE TABLE graves (usn integer not null,oid integer not null,type integer not null);",
    );
    const models: Record<string, unknown> = {},
      decks: Record<string, unknown> = {};
    const stamp = Math.floor(Date.now() / 1000);
    for (const t of bundle.types) {
      let templates = t.templates;
      if (/anking/i.test(t.name)) {
        templates = [
          {
            ord: 0,
            name: "Recall cloze",
            front: "{{cloze:Text}}",
            back: "{{cloze:Text}}<hr>{{Extra}}",
          },
        ];
        report.push(
          `${t.name}: exported as a standard cloze; one-by-one scripts and resource layout are not reproduced.`,
        );
      }
      models[t.originalId] = {
        id: Number(t.originalId),
        name: t.name,
        type: t.kind === "basic" ? 0 : 1,
        mod: stamp,
        usn: -1,
        sortf: 0,
        did: 1,
        tmpls: templates.map((t) => ({
          name: t.name,
          ord: t.ord,
          qfmt: t.front,
          afmt: t.back,
          bqfmt: "",
          bafmt: "",
          did: null,
        })),
        flds: t.fields.map((name, ord) => ({
          name,
          ord,
          sticky: false,
          rtl: false,
          font: "Arial",
          size: 20,
        })),
        css: ".card { font-family: Arial; font-size: 20px; text-align: center; color: black; background: white; } .cloze { font-weight: bold; color: #12695a; }",
        latexPre: "",
        latexPost: "",
        req: [],
        tags: [],
        vers: [],
      };
    }
    for (const d of bundle.decks)
      decks[d.originalId] = {
        id: Number(d.originalId),
        name: d.name,
        mod: stamp,
        usn: -1,
        desc: "",
        dyn: 0,
        collapsed: false,
        conf: 1,
        extendNew: 0,
        extendRev: 0,
      };
    db.run("INSERT INTO col VALUES (1,?,?,?,?,0,-1,0,?,?,?,?,?)", [
      stamp,
      stamp * 1000,
      stamp * 1000,
      11,
      JSON.stringify({
        nextPos: 1,
        curDeck: 1,
        activeDecks: [1],
        newSpread: 0,
      }),
      JSON.stringify(models),
      JSON.stringify(decks),
      "{}",
      "{}",
    ]);
    const typeMap = new Map(bundle.types.map((t) => [t.id, t]));
    const noteMap = new Map(bundle.notes.map((n) => [n.id, n]));
    const deckMap = new Map(bundle.decks.map((d) => [d.id, d]));
    for (const n of bundle.notes) {
      const t = typeMap.get(n.typeId)!;
      db.run("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
        n.originalId,
        n.guid,
        t.originalId,
        stamp,
        -1,
        ` ${n.tags.join(" ")} `,
        n.fields.join("\x1f"),
        n.fields[0] ?? "",
        0,
        0,
        "",
      ]);
    }
    for (const c of bundle.cards) {
      if (!c.supported) {
        report.push(
          `Preserved unsupported card ${c.originalId} with its original template; verify in Anki.`,
        );
      }
      db.run("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        c.originalId,
        noteMap.get(c.noteId)!.originalId,
        deckMap.get(c.deckId)!.originalId,
        c.ord,
        stamp,
        -1,
        0,
        c.suspended ? -1 : 0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        c.flagged ? 1 : 0,
        "",
      ]);
    }
    const zip = new ZipWriter(new BlobWriter("application/zip"));
    await zip.add("collection.anki2", new Uint8ArrayReader(db.export()));
    const map: Record<string, string> = {};
    for (let i = 0; i < bundle.media.length; i++) {
      map[String(i)] = bundle.media[i].name;
      await zip.add(String(i), new BlobReader(bundle.media[i].blob));
    }
    await zip.add("media", new TextReader(JSON.stringify(map)));
    return { blob: await zip.close(), report };
  } finally {
    db.close();
  }
}
