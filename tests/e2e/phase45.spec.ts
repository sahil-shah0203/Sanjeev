import { test, expect } from "@playwright/test";
import { compileSourceActivity } from "@recall/learning";
import { id, type Note } from "@recall/domain";

test("student navigation separates preferences, recovery and help; AI starts off", async ({
  page,
}) => {
  await page.route("**/api/config", (r) =>
    r.fulfill({
      json: {
        adaptive: true,
        generation: true,
        sourcePractice: true,
        provider: "OpenAI",
      },
    }),
  );
  await page.goto("/");
  await expect(page).toHaveTitle(/Sanjeev/);
  await expect(page.getByRole("link", { name: /Import.*deck/ })).toHaveCount(1);
  await page
    .getByRole("button", { name: "Or try 6 demonstration cards" })
    .click();
  await expect(page.getByRole("switch")).not.toBeChecked();
  await expect(page.getByRole("switch")).toBeDisabled();
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Study preferences" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send sign-in link" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: /AI|evaluation|understanding/ }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Open Account & data" }).click();
  await expect(
    page.getByRole("heading", { name: "Account & data", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download native backup" }),
  ).toBeVisible();
  await expect(page.getByLabel("Session length")).toHaveCount(0);
  await page.goto("/help");
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/sanjeev-help.png",
    fullPage: true,
  });
  await page.goto("/");
  await page.screenshot({
    path: "test-results/sanjeev-today.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/sanjeev-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByTestId("card-face")).toBeVisible();
});

test("source exercise supports self-check and immediate quarantine without FSRS credit", async ({
  page,
}) => {
  await page.route("**/api/config", (r) =>
    r.fulfill({
      json: {
        adaptive: true,
        generation: true,
        sourcePractice: true,
        provider: "fixture",
      },
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Or try 6 demonstration cards" })
    .click();
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByTestId("card-face")).toBeVisible();
  const sessionId = page.url().split("/").at(-1)!;
  const note = (await page.evaluate(async () => {
    const req = indexedDB.open(
      `recall-v1-${localStorage.getItem("recall-guest")}`,
    );
    const db = await new Promise<IDBDatabase>((resolve) => {
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction("notes");
    const notes = await new Promise<any[]>((resolve) => {
      const r = tx.objectStore("notes").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return notes[0];
  })) as Note;
  const activity = compileSourceActivity(
    note,
    { unit: 0, variant: "recall" },
    { id: id(), version: id(), modelVersion: "fixture" },
  );
  await page.evaluate(
    async ({ sessionId, activity, note }) => {
      const req = indexedDB.open(
        `recall-v1-${localStorage.getItem("recall-guest")}`,
      );
      const db = await new Promise<IDBDatabase>((resolve) => {
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction(
        ["sessions", "activities", "reviews"],
        "readwrite",
      );
      const finished = new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      const session = await new Promise<any>((resolve) => {
        const r = tx.objectStore("sessions").get(sessionId);
        r.onsuccess = () => resolve(r.result);
      });
      tx.objectStore("sessions").put({
        ...session,
        reviews: 9,
        aiQuestions: true,
        aiRequests: 3,
      });
      tx.objectStore("activities").put(activity);
      // Synthetic prior exposure lets selection use a reviewed source, never an upcoming answer.
      tx.objectStore("reviews").put({
        id: crypto.randomUUID(),
        sessionId,
        noteId: note.id,
        at: new Date().toISOString(),
        status: "canonical",
      });
      await finished;
      db.close();
    },
    { sessionId, activity, note },
  );
  await page.reload();
  await page.getByRole("button", { name: /Show answer/ }).click();
  await page.getByRole("button", { name: /^Easy/ }).click();
  await expect(
    page.getByText("AI-GENERATED · UNVERIFIED", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Your answer", { exact: true }).fill("My own phrasing");
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByText(/uncertain ·/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request rubric feedback" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "I need more practice" }).click();
  await expect(page.getByText(/Self-check recorded/)).toBeVisible();
  await page
    .getByRole("button", { name: "Report question", exact: true })
    .click();
  await expect(page.getByText(/10 reviewed/)).toBeVisible();
  const stored = await page.evaluate(async (activityId) => {
    const req = indexedDB.open(
      `recall-v1-${localStorage.getItem("recall-guest")}`,
    );
    const db = await new Promise<IDBDatabase>((resolve) => {
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction(["reviews", "activities", "attempts"]);
    const read = (r: IDBRequest) =>
      new Promise<any>((resolve) => {
        r.onsuccess = () => resolve(r.result);
      });
    const result = {
      reviews: await read(tx.objectStore("reviews").count()),
      activity: await read(tx.objectStore("activities").get(activityId)),
      attempts: await read(tx.objectStore("attempts").getAll()),
    };
    db.close();
    return result;
  }, activity.id);
  expect(stored.reviews).toBe(2);
  expect(stored.activity.status).toBe("quarantined");
  expect(stored.attempts).toHaveLength(1);
  expect(stored.attempts[0]).toMatchObject({
    contaminated: true,
    grade: "uncertain",
    adjudication: "needs more practice",
  });
});
