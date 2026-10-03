import { cp, mkdir } from "node:fs/promises";
const destination = "apps/web/.next/standalone/apps/web";
await mkdir(`${destination}/.next`, { recursive: true });
await cp("apps/web/.next/static", `${destination}/.next/static`, {
  recursive: true,
});
await cp("apps/web/public", `${destination}/public`, { recursive: true });
console.log(
  "Standalone server includes static assets, fonts, WASM, and the offline shell.",
);
