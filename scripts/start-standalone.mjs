import { existsSync } from "node:fs";

// Local development keeps secrets in ignored env files. Hosted runtimes inject
// these values directly, so missing files are expected in the container.
for (const file of [".env", "apps/web/.env.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

await import("../apps/web/.next/standalone/apps/web/server.js");
