import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      [
        "domain",
        "scheduler",
        "importer",
        "card-renderer",
        "learning",
        "sync",
        "exporter",
        "ai",
      ].map((n) => [
        `@recall/${n}`,
        path.resolve(`packages/${n}/src/index.ts`),
      ]),
    ),
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: "forks",
    maxWorkers: 2,
  },
});
