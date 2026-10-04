import { expect, it } from "vitest";
import { parsePackage, zstd } from "@recall/importer";
import { syntheticPackage, rawZstd, wasmUrl, proto } from "./helpers/anki";
import { compatibility, renderCard } from "@recall/card-renderer";
import { demoBundle } from "../apps/web/features/demo";

it.each([true, false])(
  "imports a public modern=%s corpus with exact identities, Unicode and gapped media",
  async (modern) => {
    const bundle = await parsePackage(await syntheticPackage(modern), {
      wasmUrl,
    });
    expect(bundle.cards).toHaveLength(6);
    expect(bundle.report.ready).toBe(6);
    expect(bundle.media.map((m) => m.name)).toEqual(["diagram.png"]);
    expect(bundle.report.missingMedia).toEqual([]);
    expect(bundle.decks[0].name).toBe("Synthetic::Unicode Ω");
    expect(bundle.notes[0].tags).toContain("日本語");
    expect(bundle.cards.map((c) => c.originalId)).toEqual(
      Array.from({ length: 6 }, (_, i) => String(1700000000100 + i)),
    );
  },
);
it("quarantines missing template-only question media and rejects orphan metadata", async () => {
  const missing = await syntheticPackage(true, (db) =>
    db.run("UPDATE templates SET config=?", [
      proto(
        [1, '<img src="missing-prompt.png">{{cloze:Text}}'],
        [2, "{{cloze:Text}}"],
      ),
    ]),
  );
  const parsed = await parsePackage(missing, { wasmUrl });
  expect(parsed.report.missingMedia).toContain("missing-prompt.png");
  expect(parsed.cards.every((c) => !c.supported)).toBe(true);
  const file = await syntheticPackage(true, (db) =>
    db.run("UPDATE notes SET mid=999 WHERE id=1700000000000"),
  );
  await expect(parsePackage(file, { wasmUrl })).rejects.toThrow(
    "Missing note type",
  );
  const b = await demoBundle();
  b.types[0].kind = "basic";
  b.types[0].templates[0].front = '{{#Extra}}<img src="diagram.png">{{/Extra}}';
  b.notes[0].fields[1] = '<img src="diagram.png">';
  expect(renderCard(b.types[0], b.notes[0], 0, false).html).toContain(
    "diagram.png",
  );
  expect(compatibility(b.types[0], b.notes[0], 0).supported).toBe(true);
});
it("decodes bounded unknown-size frames and rejects truncation, concatenation and expansion bombs", () => {
  const source = new TextEncoder().encode("public synthetic data".repeat(100));
  const packed = rawZstd(source, true);
  expect(zstd(packed, 2 * 1024 ** 2)).toEqual(source);
  expect(() => zstd(packed.slice(0, -1), 2 * 1024 ** 2)).toThrow();
  expect(() =>
    zstd(new Uint8Array([...packed, ...packed]), 2 * 1024 ** 2),
  ).toThrow("Concatenated");
  expect(() => zstd(rawZstd(source), 10)).toThrow("limit");
});
