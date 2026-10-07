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
