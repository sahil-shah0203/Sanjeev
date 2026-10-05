import { parsePackage } from "@recall/importer";
import { Library } from "../lib/db/local";
import { importError } from "../../../packages/importer/src/errors";
self.onmessage = async (
  event: MessageEvent<{ file: File; owner: string; namespace: string }>,
) => {
  const { file, owner, namespace } = event.data;
  const db = new Library(owner);
  try {
    await db.meta.put({
      id: `staging:${namespace}`,
      value: { namespace, at: new Date().toISOString() },
    });
    const bundle = await parsePackage(file, {
      namespace,
      wasmUrl: "/wasm/sql-wasm.wasm",
      progress: (phase, current, total) =>
        postMessage({ kind: "progress", phase, current, total }),
      onMedia: (asset) => db.media.put(asset).then(() => undefined),
    });
    postMessage({ kind: "result", bundle });
  } catch (e) {
    await db.media.where("namespace").equals(namespace).delete();
    await db.meta.delete(`staging:${namespace}`);
    postMessage({
      kind: "error",
      message: importError(e),
    });
  } finally {
    db.close();
  }
};
