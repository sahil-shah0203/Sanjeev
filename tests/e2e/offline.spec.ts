import { test, expect } from "@playwright/test";

test("production shell reopens an uncached study URL offline and saves an answer", async ({
  page,
  context,
}) => {
  test.skip(
    process.env.TEST_PRODUCTION !== "1",
    "Offline caching is deliberately disabled in development.",
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Or try 6 demonstration cards" })
    .click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.goto("/decks");
  await page.getByRole("link", { name: /A little practice/ }).click();
  await page.getByRole("button", { name: "Check offline readiness" }).click();
  await expect(
    page.getByText(/All 0 media files are on this device/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Study deck", exact: true }).click();
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByTestId("card-face")).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId("card-face")).toBeVisible();
  await page.getByRole("button", { name: /Show answer/ }).click();
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect(page.getByText(/1 reviewed/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/1 reviewed/)).toBeVisible();
  await context.setOffline(false);
  await page.goto("/progress");
  await expect(page.getByText("qualifying reviews recorded")).toBeVisible();
});
