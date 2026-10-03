import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parsePackage } from "../packages/importer/src/index";
const require = createRequire(import.meta.url);
const file = new File(
  [await readFile(process.argv[2] ?? "forsahil.apkg")],
  "forsahil.apkg",
);
const bundle = await parsePackage(file, {
  wasmUrl: require.resolve("sql.js/dist/sql-wasm.wasm"),
});
console.log(
  JSON.stringify(
    {
      hash: bundle.report.hash,
      notes: bundle.notes.length,
      cards: bundle.cards.length,
      ready: bundle.report.ready,
      media: bundle.media.length,
      missing: bundle.report.missingMedia,
      history: bundle.report.historyCount,
      warnings: bundle.report.warnings,
      types: bundle.types.map((t) => ({
        name: t.name,
        fields: t.fields,
        kind: t.kind,
      })),
      cardsSupport: bundle.cards.map((c) => ({
        ord: c.ord,
        supported: c.supported,
        reason: c.reason,
      })),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      detectedMime: bundle.media.reduce(
        (counts, m) => ({ ...counts, [m.mime]: (counts[m.mime] ?? 0) + 1 }),
        {} as Record<string, number>,
      ),
      filenameExtensions: bundle.media.reduce(
        (counts, m) => ({
          ...counts,
          [m.name.split(".").at(-1)!]:
            (counts[m.name.split(".").at(-1)!] ?? 0) + 1,
        }),
        {} as Record<string, number>,
      ),
      signatureExamples: await Promise.all(
        bundle.media
          .filter((m) => m.name.endsWith(".png"))
          .slice(0, 3)
          .map(async (m) => ({
            extension: "png",
            mime: m.mime,
            signature: Array.from(
              new Uint8Array(await m.blob.slice(0, 16).arrayBuffer()),
            ),
          })),
      ),
    },
    null,
    2,
  ),
);
if (
  bundle.report.hash ===
    "76a915e731d568e4c705501af8b8fa49c25fb49972aae4517d74ebd06d3035b3" &&
  (bundle.notes.length !== 3 ||
    bundle.cards.length !== 3 ||
    bundle.media.length !== 50 ||
    bundle.report.ready !== 3)
)
  throw new Error("Sample inventory mismatch.");
console.log(
  JSON.stringify(
    {
      scheduling: bundle.cards.map((c) => ({
        suspended: c.suspended,
        queue: c.raw.queue,
        type: c.raw.type,
        reps: c.raw.reps,
        due: c.raw.due,
      })),
    },
    null,
    2,
  ),
);
