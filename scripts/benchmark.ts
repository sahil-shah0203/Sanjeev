import { performance } from "node:perf_hooks";
import { cpus, platform, release, totalmem } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { demoBundle } from "../apps/web/features/demo";
import { ankiContent } from "@recall/exporter";
import { parsePackage } from "@recall/importer";
import { id } from "@recall/domain";
const count = Number(process.env.PERF_CARDS ?? 10000);
if (!Number.isSafeInteger(count) || count < 1 || count > 50000)
  throw new Error("PERF_CARDS must be 1–50,000.");
const bundle = await demoBundle(),
  templateNote = bundle.notes[0],
  templateCard = bundle.cards[0];
bundle.notes = Array.from({ length: count }, (_, index) => ({
  ...templateNote,
  id: id(),
  originalId: String(1700000100000 + index),
  guid: `synthetic-perf-${index}`,
  fields: [
    `Synthetic item ${index} has {{c1::a target}}.`,
    "Public generated benchmark text.",
  ],
}));
bundle.cards = bundle.notes.map((note, index) => ({
  ...templateCard,
  id: id(),
  noteId: note.id,
  originalId: String(1700000200000 + index),
}));
const wasmUrl = path.resolve("node_modules/sql.js/dist/sql-wasm.wasm");
const start = performance.now();
const archive = await ankiContent(bundle, wasmUrl);
const exported = performance.now();
const before = process.memoryUsage();
const parsed = await parsePackage(
  new File([archive.blob], "synthetic-performance.apkg"),
  { wasmUrl },
);
const finished = performance.now();
if (parsed.cards.length !== count || parsed.report.ready !== count)
  throw new Error("Performance fixture lost card identities.");
const result = {
  at: new Date().toISOString(),
  node: process.version,
  platform: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model,
  logicalCpus: cpus().length,
  systemMemoryGiB: Math.round(totalmem() / 1024 ** 3),
  cards: count,
  media: 0,
  archiveMiB: +(archive.blob.size / 1024 ** 2).toFixed(2),
  exportMs: Math.round(exported - start),
  importMs: Math.round(finished - exported),
  memoryBeforeMiB: Math.round(before.rss / 1024 ** 2),
  memoryAfterMiB: Math.round(process.memoryUsage().rss / 1024 ** 2),
  scope:
    "Node synthetic text-only import. RSS snapshots are not a peak-memory measurement; this does not measure mobile or media-heavy decks.",
};
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/performance.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
