import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import {
  ZipWriter,
  BlobWriter,
  TextReader,
  BlobReader,
  ZipReader,
} from "@zip.js/zip.js";
import { parsePackage, zstd, readEntry, safeName } from "@recall/importer";
import { ankiContent, nativeBackup, readBackup } from "@recall/exporter";
import { demoBundle } from "../apps/web/features/demo";
const require = createRequire(import.meta.url);
const wasmUrl = require.resolve("sql.js/dist/sql-wasm.wasm");
describe("real packages and recovery", () => {
  it.skipIf(!existsSync("forsahil.apkg"))(
    "imports the supplied modern archive instead of its compatibility placeholder",
    async () => {
      const bytes = await readFile("forsahil.apkg");
      const b = await parsePackage(new File([bytes], "sample.apkg"), {
        wasmUrl,
      });
      expect(b.report.hash).toBe(
        "76a915e731d568e4c705501af8b8fa49c25fb49972aae4517d74ebd06d3035b3",
      );
      expect([
        b.notes.length,
        b.cards.length,
        b.report.ready,
        b.media.length,
        b.report.historyCount,
      ]).toEqual([3, 3, 3, 50, 0]);
      expect(b.report.missingMedia).toEqual([]);
      expect(b.types[0].fields[0]).toBe("Text");
      expect(b.media.filter((m) => m.mime === "image/webp")).toHaveLength(46);
      expect(
        b.media.filter((m) => m.name.toLowerCase().endsWith(".webp")),
      ).toHaveLength(34);
    },
  );
  it("round trips card identities and field ordinals through legacy content export", async () => {
    const b = await demoBundle();
    b.notes[0].fields[0] = "{{c1::one}} {{c1::two}} {{c2::three}}";
    b.cards.push({
      ...b.cards[0],
      id: crypto.randomUUID(),
      originalId: "1700000000999",
      ord: 1,
    });
    const exported = await ankiContent(b, wasmUrl);
    const parsed = await parsePackage(
      new File([exported.blob], "roundtrip.apkg"),
      { wasmUrl },
    );
    expect(parsed.cards).toHaveLength(7);
    expect(parsed.notes).toHaveLength(6);
    expect(
      parsed.cards.find((c) => c.originalId === "1700000000999")?.ord,
    ).toBe(1);
    expect(parsed.notes[0].guid).toBe(b.notes[0].guid);
    expect(parsed.report.ready).toBe(7);
  });
  it("selects legacy anki21 when meta is absent", async () => {
    const b = await demoBundle();
    const exported = await ankiContent(b, wasmUrl);
    const reader = new ZipReader(new BlobReader(exported.blob));
    const writer = new ZipWriter(new BlobWriter());
    for (const entry of await reader.getEntries()) {
      const bytes = await readEntry(entry, 128 * 1024 ** 2);
      await writer.add(
        entry.filename === "collection.anki2"
          ? "collection.anki21"
          : entry.filename,
        new BlobReader(new Blob([bytes as BlobPart])),
      );
    }
    await reader.close();
    const parsed = await parsePackage(await writer.close(), { wasmUrl });
    expect(parsed.report.format).toBe("collection.anki21");
  });
  it("rejects unknown metadata and invalid SQLite instead of dropping rows", async () => {
    const z = new ZipWriter(new BlobWriter());
    await z.add("meta", new BlobReader(new Blob([new Uint8Array([8, 9])])));
    await z.add("collection.anki2", new TextReader("not SQLite"));
    await z.add("media", new TextReader("{}"));
    await expect(parsePackage(await z.close(), { wasmUrl })).rejects.toThrow(
      "Unsupported Anki package version",
    );
    const z2 = new ZipWriter(new BlobWriter());
    await z2.add("collection.anki2", new TextReader("not SQLite"));
    await expect(parsePackage(await z2.close(), { wasmUrl })).rejects.toThrow(
      "valid SQLite",
    );
  });
  it("rejects traversal and oversized or truncated inner compression", () => {
    for (const n of ["../x", "/x", "C:/x", "a\\b", "a/../b", "x\0"])
      expect(safeName(n)).toBe(false);
    expect(safeName("normal file.png")).toBe(true);
    expect(() =>
      zstd(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 255]), 1024),
    ).toThrow("window");
    expect(() =>
      zstd(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 0]), 1024 ** 2),
    ).toThrow();
  });
  it("verifies native manifests and detects tampered data before restoring", async () => {
    const b = await demoBundle();
    const data = {
      tables: {
        states: [],
        reviews: [],
        exposures: [],
        sessions: [],
        activities: [],
        attempts: [],
        reports: [],
        preferences: [],
        undos: [],
        imports: [{ ...b.report, originalPackage: undefined }],
        decks: b.decks,
        types: b.types,
        notes: b.notes,
        cards: b.cards,
      },
      media: [],
      originals: [],
    };
    const backup = await nativeBackup(data);
    const restored = await readBackup(backup);
    expect(restored.tables.notes).toEqual(b.notes);
    const reader = new ZipReader(new BlobReader(backup));
    const writer = new ZipWriter(new BlobWriter());
    for (const entry of await reader.getEntries())
      await writer.add(
        entry.filename,
        entry.filename === "library.json"
          ? new TextReader("{}")
          : new BlobReader(
              new Blob([(await readEntry(entry, 128 * 1024 ** 2)) as BlobPart]),
            ),
      );
    await reader.close();
    await expect(readBackup(await writer.close())).rejects.toThrow("checksum");
  });
});
