import { mkdir, copyFile, cp } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import "./dependency-report.mjs";
const require = createRequire(import.meta.url);
await mkdir("apps/web/public/wasm", { recursive: true });
await copyFile(
  require.resolve("sql.js/dist/sql-wasm.wasm"),
  "apps/web/public/wasm/sql-wasm.wasm",
);
await mkdir("apps/web/public/fonts", { recursive: true });
await cp(
  path.join(path.dirname(require.resolve("katex/dist/katex.css")), "fonts"),
  "apps/web/public/fonts",
  { recursive: true },
);
