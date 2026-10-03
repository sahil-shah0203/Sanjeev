import { test, expect } from "@playwright/test";
import path from "node:path";
import { existsSync } from "node:fs";
test("sample import, keyboard review, reload, backup and restore", async ({
  page,
  browser,
  baseURL,
  context,
}) => {
  test.skip(
    !existsSync(path.resolve("forsahil.apkg")),
    "Private sample is not distributed with the repository.",
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A fresh space to remember." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/recall-today.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Import deck", exact: true }).click();
  await page
    .getByLabel("Choose Anki package")
    .setInputFiles(path.resolve("forsahil.apkg"));
  await expect(
    page.getByRole("button", { name: "Import 3 cards", exact: true }),
  ).toBeEnabled({ timeout: 60000 });
  await page
    .getByRole("checkbox", { name: "Resume suspended cards on import" })
    .check();
  await page
    .getByRole("button", { name: "Import 3 cards", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your deck is ready." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Go to Today" }).click();
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
  await expect(page.getByTestId("card-face").locator(".cloze-gap")).toHaveCount(
    1,
  );
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: /^Good/ })).toBeVisible();
  await page
    .locator(".extras details")
    .evaluateAll((nodes) =>
      nodes.forEach((node) => ((node as HTMLDetailsElement).open = true)),
    );
  await expect
    .poll(() => page.locator(".card-content img").count())
    .toBeGreaterThan(0);
  await page
    .locator(".card-content img")
    .evaluateAll((nodes) =>
      nodes.forEach((node) => ((node as HTMLImageElement).loading = "eager")),
    );
  await expect
    .poll(() =>
      page
        .locator(".card-content img")
        .evaluateAll((nodes) =>
          nodes.every(
            (node) =>
              (node as HTMLImageElement).complete &&
              (node as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  await page
    .locator(".extras details")
    .evaluateAll((nodes) =>
      nodes.forEach((node) => ((node as HTMLDetailsElement).open = false)),
    );
  await page.screenshot({
    path: "test-results/recall-study.png",
    fullPage: true,
  });
  await page.keyboard.press("3");
  await expect(page.getByText(/1 reviewed/)).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText(/1 reviewed/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Show answer/ })).toBeVisible();
  await page.getByRole("button", { name: "Finish session" }).click();
  await expect(
    page.getByRole("heading", { name: "Session finished." }),
  ).toBeVisible();
  await page.goto("/settings");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download native backup" }).click();
  const download = await downloadPromise;
  const backup = path.resolve("test-results/journey.recall");
  await download.saveAs(backup);
  const clean = await browser.newContext();
  const restored = await clean.newPage();
  await restored.goto(`${baseURL}/settings`);
  await restored.getByLabel("Restore native backup").setInputFiles(backup);
  await expect(
    restored.getByText(
      "Backup validated and restored with its history and media.",
    ),
  ).toBeVisible();
  await restored.goto(`${baseURL}/progress`);
  await expect(restored.getByText("qualifying reviews recorded")).toBeVisible();
  await restored.goto(`${baseURL}/decks`);
  await expect(
    restored.getByRole("heading", { name: "AnKing Step Deck" }),
  ).toBeVisible();
  await clean.close();
  expect(errors).toEqual([]);
});
test("demo, editing, undo, responsive layout and no-attempt exposures", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Or try 6 demonstration cards" })
    .click();
  await expect(
    page.getByRole("button", { name: "Start a session" }),
  ).toBeEnabled();
  await page.screenshot({
    path: "test-results/recall-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Start a session" }).click();
  await page.getByRole("button", { name: /Show answer/ }).click();
  await page.getByRole("button", { name: /^Good/ }).click();
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.getByText(/0 reviewed/)).toBeVisible();
  await page.getByRole("button", { name: "I can’t attempt this yet" }).click();
  await expect(
    page.getByText("Saved as an exposure. This card’s schedule is unchanged."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText(/0 reviewed/)).toBeVisible();
  await page.goto("/browse");
  await page.getByLabel("Search cards").fill("triangle");
  await expect(page.getByText("1 cards", { exact: true })).toBeVisible();
  await expect(page.locator(".card-link").first()).not.toContainText("{{c1::");
  await page.getByRole("button", { name: /A triangle/ }).click();
  await page.getByRole("button", { name: "Edit source" }).click();
  await page
    .getByRole("textbox", { name: "Text", exact: true })
    .fill("A triangle has {{c1::three}} straight sides.");
  await page.getByRole("button", { name: "Save source" }).click();
  await page.getByRole("button", { name: "Close card details" }).click();
  await expect(page.getByText(/Source updated/)).toBeVisible();
});
