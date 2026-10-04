import { test, expect } from "@playwright/test";

test("approved synthetic check supports uncertainty and self-check without extra scheduling credit", async ({
  page,
}) => {
  await page.route("**/api/config", (route) =>
    route.fulfill({ json: { adaptive: true, generation: false } }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Or try 6 demonstration cards" })
    .click();
  await page.getByRole("button", { name: "Start a session" }).click();
  await expect(page.getByTestId("card-face")).toBeVisible();
  const sessionId = page.url().split("/").at(-1)!;
  await page.evaluate(async (sessionId) => {
    const owner = localStorage.getItem("recall-guest");
    const request = indexedDB.open(`recall-v1-${owner}`);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const tx = db.transaction(
      [
        "notes",
        "preferences",
        "sessions",
        "activities",
        "reviews",
        "states",
        "cards",
      ],
      "readwrite",
    );
    const finished = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    const notes = await read(tx.objectStore("notes").getAll());
    const source = notes.find((n) => n.guid === "recall-demo-5");
    const cards = await read(tx.objectStore("cards").getAll());
    const card = cards.find((c) => c.noteId === source.id);
    const state = await read(tx.objectStore("states").get(card.id));
    for (const daysAgo of [1, 2]) {
      const date = new Date(Date.now() - daysAgo * 86400000);
      tx.objectStore("reviews").put({
        id: crypto.randomUUID(),
        cardId: card.id,
        noteId: source.id,
        sessionId,
        deviceId: "synthetic-test",
        sequence: daysAgo,
        parent: null,
        baseVersion: 0,
        before: state,
        after: state,
        config: state.config,
        contentVersion: source.version,
        durationMs: 2000,
        status: "canonical",
        rating: "again",
        at: date.toISOString(),
        effectiveAt: date.toISOString(),
        studyDay: date.toISOString().slice(0, 10),
      });
    }
    const session = await read(tx.objectStore("sessions").get(sessionId));
    tx.objectStore("sessions").put({ ...session, reviews: 9 });
    tx.objectStore("preferences").put({
      id: "preferences",
      newLimit: 20,
      retention: 0.9,
      timezone: "UTC",
      rollover: 4,
      budgetMinutes: 15,
      theme: "light",
      adaptive: true,
      aiConsent: false,
      evaluationConsent: false,
      burySiblings: true,
    });
    tx.objectStore("activities").put({
      id: crypto.randomUUID(),
      version: "synthetic-test-1",
      objective: "Recall a synthetic polygon fact",
      format: "short_answer",
      cognitiveTask: "recall",
      stem: "How many sides does a hexagon have?",
      acceptedAnswers: ["six"],
      rationale: "A hexagon has six sides.",
      sources: [
        {
          noteId: source.id,
          version: source.version,
          field: 0,
          quote: source.fields[0],
        },
      ],
      expectedSeconds: 15,
      status: "human_approved",
      reviewerId: "synthetic-test-reviewer",
      approvedHash: "synthetic-test-only",
      modelVersion: null,
      promptVersion: "test",
      validatorVersion: "test",
    });
    await finished;
    db.close();
  }, sessionId);
  await page.reload();
  await page.getByRole("button", { name: /Show answer/ }).click();
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect(
    page.getByRole("heading", { name: "How many sides does a hexagon have?" }),
  ).toBeVisible();
  await page.getByLabel("Your answer", { exact: true }).fill("seven");
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByText(/uncertain ·/)).toBeVisible();
  await page
    .getByRole("button", { name: "I need more practice", exact: true })
    .click();
  await expect(page.getByText(/Self-check recorded/)).toBeVisible();
  await page
    .getByRole("button", { name: "Continue review", exact: true })
    .click();
  await expect(page.getByText(/10 reviewed/)).toBeVisible();
  const counts = await page.evaluate(async () => {
    const request = indexedDB.open(
      `recall-v1-${localStorage.getItem("recall-guest")}`,
    );
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const transaction = db.transaction(["reviews", "attempts"]);
    const read = (request: IDBRequest) =>
      new Promise<any>((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
    const reviews = await read(transaction.objectStore("reviews").count());
    const attempts = await read(transaction.objectStore("attempts").getAll());
    db.close();
    return { reviews, attempts };
  });
  expect(counts.reviews).toBe(3);
  expect(counts.attempts).toHaveLength(1);
  expect(counts.attempts[0]).toMatchObject({
    grade: "uncertain",
    adjudication: "needs more practice",
  });
});
