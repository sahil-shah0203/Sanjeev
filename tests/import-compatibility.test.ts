import { expect, it } from "vitest";
import { parsePackage } from "@recall/importer";
import { hash } from "@recall/domain";
import { renderCard } from "@recall/card-renderer";
import { safeSvg } from "../packages/card-renderer/src/svg";
import {
  enhancedPackage,
  legacyContainer,
  questionMask,
  syntheticPackage,
  wasmUrl,
} from "./helpers/anki";

it.each([
  [1, true],
  [1, false],
  [2, true],
  [2, false],
] as const)(
  "reads version %s with metadata=%s without selecting the dummy collection",
  async (version, meta) => {
    const file = await legacyContainer(
      await syntheticPackage(false),
      version,
      meta,
    );
    const b = await parsePackage(file, { wasmUrl });
    expect(b.report.ready).toBe(6);
    expect(b.report.format).toBe(
      version === 1 ? "collection.anki2" : "collection.anki21",
    );
    expect(b.report.hash).toBe(await hash(await file.arrayBuffer()));
    expect(b.media[0].name).toBe("diagram.png");
  },
);
it("rejects unknown versions, missing real collections and cancelled imports", async () => {
  const legacy = await syntheticPackage(false);
  for (const version of [0, 4])
    await expect(
      parsePackage(await legacyContainer(legacy, version), { wasmUrl }),
    ).rejects.toThrow("unknown Anki package version");
  await expect(
    parsePackage(await legacyContainer(legacy, 2, true, true), { wasmUrl }),
  ).rejects.toThrow("missing: collection.anki21");
  const abort = new AbortController();
  await expect(
    parsePackage(legacy, {
      wasmUrl,
      signal: abort.signal,
      progress: () => abort.abort(),
    }),
  ).rejects.toThrow("cancelled");
});
it("imports enhanced image occlusion, preserving all masks while rendering only native content", async () => {
  const b = await parsePackage(await enhancedPackage(), { wasmUrl });
  expect(b.report.ready).toBe(1);
  expect(b.report.missingMedia).toEqual([]);
  expect(b.media.filter((m) => m.mime === "image/svg+xml")).toHaveLength(2);
  expect(
    await b.media.find((m) => m.name === "question.svg")!.blob.text(),
  ).toBe(questionMask);
  const question = renderCard(b.types[0], b.notes[0], 0, false);
  expect(question.html).toBe("Recall the covered shape");
  expect(question.extras).toEqual([]);
  expect(renderCard(b.types[0], b.notes[0], 0, true).extras[0].html).toBe(
    "Synthetic explanation.",
  );
});
it("quarantines missing or unsafe masks rather than exposing the base image", async () => {
  const missing = await parsePackage(
    await enhancedPackage(questionMask, true),
    { wasmUrl },
  );
  expect(missing.report.ready).toBe(0);
  const unsafe = await parsePackage(
    await enhancedPackage(
      questionMask.replace("<g>", "<g><script>alert(1)</script>"),
    ),
    { wasmUrl },
  );
  expect(unsafe.report.ready).toBe(0);
  expect(unsafe.media).toHaveLength(3);
  expect(unsafe.report.warnings.join(" ")).toContain("Unsupported SVG");
});
it("preserves static shape geometry, presentation and transforms", () => {
  expect(
    safeSvg(
      questionMask.replace(
        'fill="#ff0000"',
        'style="fill:#00ff00" fill="#ff0000"',
      ),
    ),
  ).toContain('fill="#00ff00"');
  const output = safeSvg(
    questionMask.replace(
      "<g>",
      '<g transform="rotate(10 50 50)" style="stroke:#000000;stroke-width:2">',
    ),
  );
  expect(output).toContain('transform="rotate(10 50 50)"');
  expect(output).toContain('fill="#ff0000"');
  expect(output).toContain('stroke-width="2"');
});
it.each([
  "<script>alert(1)</script>",
  '<image href="https://example.org/private"/>',
  '<rect width="10" height="10" fill="url(https://example.org/x)"/>',
  "<foreignObject><div>Unsafe</div></foreignObject>",
  '<animate attributeName="opacity"/>',
  '<rect style="fill:u\\72l(https://example.org/x)"/>',
  '<rect onload="alert(1)"/>',
  '<use href="#a"/>',
  "<g><rect></g>",
])(
  "rejects active or unsupported SVG without silently dropping shapes: %s",
  (body) => {
    expect(() =>
      safeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${body}</svg>`,
      ),
    ).toThrow();
  },
);
it("bounds XML complexity, external declarations and pixel dimensions", () => {
  expect(() =>
    safeSvg(
      '<!DOCTYPE svg [<!ENTITY a SYSTEM "file:///secret">]>' + questionMask,
    ),
  ).toThrow();
  expect(() =>
    safeSvg(questionMask.replace('width="100"', 'width="999999999"')),
  ).toThrow();
  expect(() =>
    safeSvg(
      questionMask
        .replace("<g>", "<g>".repeat(40))
        .replace("</g>", "</g>".repeat(40)),
    ),
  ).toThrow();
});
