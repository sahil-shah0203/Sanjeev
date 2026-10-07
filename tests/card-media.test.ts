import "fake-indexeddb/auto";
import { it, expect, vi, afterEach } from "vitest";
import { id } from "@recall/domain";
import { Library } from "../apps/web/lib/db/local";
import { demoBundle } from "../apps/web/features/demo";
import {
  prepareCardMedia,
  peekCardMedia,
} from "../apps/web/features/card-media";
afterEach(() => vi.unstubAllGlobals());
it("preserves a safe local image when speculative preload decoding fails", async () => {
  const db = new Library(id());
  try {
    const bundle = await demoBundle();
    const note = { ...bundle.notes[0], fields: ['<img src="mask.svg">'] };
    const blob = new Blob(
      [
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="40" height="40" fill="red"/></svg>',
      ],
      { type: "image/svg+xml" },
    );
    await db.media.put({
      id: id(),
      namespace: note.namespace,
      name: "mask.svg",
      hash: "b".repeat(64),
      mime: "image/svg+xml",
      size: blob.size,
      blob,
    });
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = vi
          .fn()
          .mockRejectedValue(new Error("Speculative decode interrupted"));
      },
    );
    const prepared = await prepareCardMedia(db, note, bundle.types[0]);
    expect(prepared.urls.get("mask.svg")).toMatch(/^blob:/);
    expect(
      (await prepareCardMedia(db, note, bundle.types[0])).urls.has("mask.svg"),
    ).toBe(true);
  } finally {
    await db.delete();
  }
});
it("waits for decode, reuses prepared media, and distinguishes real missing assets", async () => {
  const db = new Library(id());
  try {
    const bundle = await demoBundle();
    const note = { ...bundle.notes[0], fields: ['<img src="diagram.png">'] };
    const type = bundle.types[0];
    const blob = new Blob(["synthetic"], { type: "image/png" });
    await db.media.put({
      id: id(),
      namespace: note.namespace,
      name: "diagram.png",
      hash: "a".repeat(64),
      mime: "image/png",
      size: blob.size,
      blob,
    });
    let release!: () => void;
    const decode = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        decode = decode;
      },
    );
    const pending = prepareCardMedia(db, note, type);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    expect(peekCardMedia(db, note, type)).toBeUndefined();
    release();
    const prepared = await pending;
    expect(prepared.urls.has("diagram.png")).toBe(true);
    expect(await prepareCardMedia(db, note, type)).toBe(prepared);
    expect(decode).toHaveBeenCalledOnce();
    const missing = await prepareCardMedia(
      db,
      { ...note, id: id(), fields: ['<img src="missing.png">'] },
      type,
    );
    expect(missing.urls.size).toBe(0);
  } finally {
    await db.delete();
  }
});
