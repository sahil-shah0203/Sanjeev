import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  webServer: process.env.CI
    ? {
        command: "npm run start",
        url: "http://localhost:3000",
        timeout: 60000,
        reuseExistingServer: false,
      }
    : undefined,
  use: {
    baseURL: process.env.TEST_BASE_URL ?? "http://localhost:3000",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
