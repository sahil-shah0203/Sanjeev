import { test, expect, chromium } from "@playwright/test";
import { enhancedPackage } from "../helpers/anki";
import path from "node:path";

test("version-2 image masks survive reveal, zoom, offline reload and review", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const file = await enhancedPackage();
  await page.goto("/import");
  await page.getByLabel("Choose Anki package").setInputFiles({
    name: file.name,
    mimeType: "application/zip",
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  await page
    .getByRole("button", { name: "Import 1 cards", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your deck is ready." }),
  ).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "Start review" }).click();
  const question = page.getByRole("img", {
    name: "Image occlusion question",
    exact: true,
  });
  await expect(question).toBeVisible();
  const pixel = (name: string, x: number, y: number) =>
    page
      .getByRole("img", { name, exact: true })
      .evaluate(
        (canvas: HTMLCanvasElement, [x, y]) => [
          ...canvas.getContext("2d")!.getImageData(x, y, 1, 1).data,
        ],
        [x, y],
      );
  expect(await pixel("Image occlusion question", 50, 50)).toEqual([
    255, 0, 0, 255,
  ]);
  await page.getByRole("button", { name: "Zoom masked image" }).click();
  expect(await pixel("Image occlusion question", 50, 50)).toEqual([
    255, 0, 0, 255,
  ]);
  await expect(
    page.getByRole("button", { name: "Hide remaining masks" }),
  ).toHaveCount(0);
  await expect(page.locator(".card-content img")).toHaveCount(0);
  if (process.env.TEST_PRODUCTION === "1") {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.reload();
    await expect(question).toBeVisible();
    expect(await pixel("Image occlusion question", 50, 50)).toEqual([
      255, 0, 0, 255,
    ]);
  }
  await page.getByRole("button", { name: /Show answer/ }).click();
  await expect(
    page.getByRole("img", { name: "Image occlusion answer", exact: true }),
  ).toBeVisible();
  expect(await pixel("Image occlusion answer", 50, 50)).toEqual([
    255, 255, 255, 255,
  ]);
  expect(await pixel("Image occlusion answer", 5, 5)).toEqual([0, 0, 255, 255]);
  await page.getByRole("button", { name: "Hide remaining masks" }).click();
  await expect
    .poll(() => pixel("Image occlusion answer", 5, 5))
    .toEqual([255, 255, 255, 255]);
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect(page.locator(".end-stats strong").first()).toHaveText("1");
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test("large private package imports completely on this device", async ({
  baseURL,
}) => {
  test.skip(
    !process.env.PRIVATE_APKG,
    "Optional private sample; never included in fixtures or uploaded by this guest test.",
  );
  test.setTimeout(600000);
  // Use an isolated disk-backed profile: private browser contexts have a
  // separate, variable memory-backed quota unrelated to normal disk capacity.
  const context = await chromium.launchPersistentContext(
    test.info().outputPath("private-browser-profile"),
    { headless: true, baseURL },
  );
  const page = await context.newPage();
  try {
    await page.goto("/import");
    await page
      .getByLabel("Choose Anki package")
      .setInputFiles(path.resolve(process.env.PRIVATE_APKG!));
    const commit = page.getByRole("button", {
      name: "Import 1437 cards",
      exact: true,
    });
    await expect(commit).toBeVisible({ timeout: 540000 });
    console.log(
      "Private import storage before commit",
      await page.evaluate(() => navigator.storage.estimate()),
    );
    await commit.click();
    await expect(
      page.getByRole("heading", { name: "Your deck is ready." }),
    ).toBeVisible({ timeout: 30000 });
    console.log("Private package committed");
    const inventory = await page.evaluate(async () => {
      const request = indexedDB.open(
        `recall-v1-${localStorage.getItem("recall-guest")}`,
      );
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      try {
        const tx = db.transaction(["cards", "notes", "types", "media"]);
        const [cards, notes, types, media] = await Promise.all([
          read(tx.objectStore("cards").getAll()),
          read(tx.objectStore("notes").getAll()),
          read(tx.objectStore("types").getAll()),
          read(tx.objectStore("media").count()),
        ]);
        const target = cards.find((card) => {
          const note = notes.find((n) => n.id === card.noteId);
          return (
            card.supported &&
            !card.suspended &&
            types
              .find((t) => t.id === note.typeId)
              ?.fields.includes("Question Mask")
          );
        });
        return {
          cards: cards.length,
          ready: cards.filter((c) => c.supported).length,
          notes: notes.length,
          media,
          target: target?.id,
          excluded: cards.filter((c) => c.id !== target?.id).map((c) => c.id),
        };
      } finally {
        db.close();
      }
    });
    expect(inventory).toMatchObject({
      cards: 1437,
      ready: 1437,
      notes: 1374,
      media: 3738,
    });
    expect(inventory.target).toBeTruthy();
    console.log("Private inventory verified");
    await page.goto("/");
    await page.getByRole("button", { name: "Start review" }).click();
    await expect(page.getByTestId("card-face")).toBeVisible();
    // Focus this test session on one actual masked card. Original card content,
    // source scheduling and persisted review states are not modified by setup.
    await page.evaluate(async (excluded) => {
      const sessionId = location.pathname.split("/").at(-1)!;
      const request = indexedDB.open(
        `recall-v1-${localStorage.getItem("recall-guest")}`,
      );
      const db = await new Promise<IDBDatabase>((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("sessions", "readwrite");
          const get = tx.objectStore("sessions").get(sessionId);
          get.onsuccess = () =>
            tx.objectStore("sessions").put({ ...get.result, excluded });
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, inventory.excluded);
    await page.reload();
    await expect(
      page.getByRole("img", { name: "Image occlusion question", exact: true }),
    ).toBeVisible();
    console.log("Private question mask displayed");
    if (process.env.TEST_PRODUCTION === "1") {
      await expect
        .poll(
          () =>
            page.evaluate(async () =>
              Boolean(
                (await navigator.serviceWorker.getRegistration())?.active,
              ),
            ),
          { timeout: 30000 },
        )
        .toBe(true);
      console.log("Private offline worker ready");
      await context.setOffline(true);
      await page.reload();
      await expect(
        page.getByRole("img", {
          name: "Image occlusion question",
          exact: true,
        }),
      ).toBeVisible();
      console.log("Private question mask reloaded offline");
    }
    await page.getByRole("button", { name: /Show answer/ }).click();
    await expect(
      page.getByRole("img", { name: "Image occlusion answer", exact: true }),
    ).toBeVisible();
    console.log("Private answer mask displayed");
    await page.getByRole("button", { name: /^Good/ }).click();
    await expect(page.locator(".end-stats strong").first()).toHaveText("1");
    await page.reload();
    await expect(page.locator(".end-stats strong").first()).toHaveText("1");
    await context.setOffline(false);
  } finally {
    await context.close();
  }
});
