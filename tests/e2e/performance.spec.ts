import { test, expect } from "@playwright/test";

test("browse searches 50,000 synthetic cards with bounded DOM output", async ({
  page,
}) => {
  test.skip(
    process.env.PERF_BROWSER !== "1",
    "Opt-in desktop performance benchmark.",
  );
  test.setTimeout(180000);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Or try 6 demonstration cards" })
    .click();
  await expect(
    page.getByRole("button", { name: "Start a session" }),
  ).toBeEnabled();
  await page.evaluate(async () => {
    const request = indexedDB.open(
      `recall-v1-${localStorage.getItem("recall-guest")}`,
    );
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const read = <T>(r: IDBRequest<T>) =>
      new Promise<T>((resolve) => {
        r.onsuccess = () => resolve(r.result);
      });
    const initial = db.transaction(["cards", "notes"]);
    const [cards, notes] = await Promise.all([
      read(initial.objectStore("cards").getAll()),
      read(initial.objectStore("notes").getAll()),
    ]);
    const card = cards[0],
      note = notes.find((n) => n.id === card.noteId);
    const tx = db.transaction(["cards", "notes"], "readwrite");
    const complete = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    tx.objectStore("cards").clear();
    tx.objectStore("notes").clear();
    for (let i = 0; i < 50000; i++) {
      tx.objectStore("notes").put({
        ...note,
        id: `perf-note-${i}`,
        fields: [`Synthetic ${i} has {{c1::a target}}.`, "Public test text"],
        tags: ["benchmark"],
      });
      tx.objectStore("cards").put({
        ...card,
        id: `perf-card-${i}`,
        noteId: `perf-note-${i}`,
      });
    }
    await complete;
    db.close();
  });
  const opened = Date.now();
  await page.goto("/browse");
  await expect(page.getByText("50,000 cards", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const initialMs = Date.now() - opened;
  const searchStart = Date.now();
  await page.getByLabel("Search cards").fill("Synthetic 49999");
  await expect(page.getByText("1 cards", { exact: true })).toBeVisible();
  const searchMs = Date.now() - searchStart;
  await expect(page.locator(".card-link")).toHaveCount(1);
  expect(searchMs).toBeLessThan(2000);
  await test
    .info()
    .attach("performance", {
      body: JSON.stringify(
        {
          cards: 50000,
          initialMs,
          searchMs,
          scope:
            "Desktop Chromium, text-only synthetic IndexedDB library; not a mobile benchmark",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  console.log(JSON.stringify({ initialMs, searchMs, cards: 50000 }));
});
