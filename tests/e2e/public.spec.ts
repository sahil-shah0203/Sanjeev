import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticPackage } from "../helpers/anki";

test("public modern package imports, reopens offline and restores with media", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const file = await syntheticPackage(true);
  await page.goto("/import");
  await page
    .getByLabel("Choose Anki package")
    .setInputFiles({
      name: file.name,
      mimeType: "application/zip",
      buffer: Buffer.from(await file.arrayBuffer()),
    });
  await page
    .getByRole("button", { name: "Import 6 cards", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your deck is ready." }),
  ).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "Start a session" }).click();
  await expect(page.getByTestId("card-face")).toBeVisible();
  if (process.env.TEST_PRODUCTION === "1") {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("card-face")).toBeVisible();
  }
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: /^Good/ })).toBeVisible();
  await page.keyboard.press("3");
  await expect(page.getByText(/1 reviewed/)).toBeVisible();
  await context.setOffline(false);
  await page.goto("/settings");
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download native backup" }).click();
  const download = await promise;
  const backup = test.info().outputPath("public.recall");
  await download.saveAs(backup);
  const clean = await browser.newContext();
  try {
    const restored = await clean.newPage();
    await restored.goto(`${baseURL}/settings`);
    await restored.getByLabel("Restore native backup").setInputFiles(backup);
    await expect(
      restored.getByText(
        "Backup validated and restored with its history and media.",
      ),
    ).toBeVisible();
    await restored.goto(`${baseURL}/browse`);
    await restored.getByLabel("Search cards").fill("triangle");
    await restored.getByRole("button", { name: /A triangle/ }).click();
    await expect(
      restored.getByRole("button", { name: "Edit source" }),
    ).toBeVisible();
  } finally {
    await clean.close();
  }
});

test("mobile and desktop core pages pass automated accessibility checks", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Or try 6 demonstration cards" })
    .click();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/browse", "/settings", "/progress", "/import"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(result.violations, `${path} at ${width}px`).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});
