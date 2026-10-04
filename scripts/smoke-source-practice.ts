// Explicit hosted smoke using a temporary synthetic account. Never uploads private decks.
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { demoBundle } from "../apps/web/features/demo";
import { ankiContent } from "@recall/exporter";
import { hash } from "@recall/domain";
try {
  process.loadEnvFile(".env");
} catch {}
const origin = process.env.SMOKE_ORIGIN;
if (!origin)
  throw new Error("Set SMOKE_ORIGIN to explicitly select the deployment.");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 15000,
});
const browser = await chromium.launch();
let owner: string | undefined;
try {
  const email = `sanjeev-smoke-${randomUUID()}@example.com`,
    password = randomUUID() + randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: "isolated-source-practice-smoke" },
  });
  if (error || !data.user)
    throw new Error("Synthetic account creation failed.");
  owner = data.user.id;
  const cookies: { name: string; value: string }[] = [];
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => cookies,
      setAll: (updates) => {
        for (const c of updates) {
          const old = cookies.find((x) => x.name === c.name);
          if (old) old.value = c.value;
          else cookies.push(c);
        }
      },
    },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error("Synthetic sign-in failed.");
  const context = await browser.newContext();
  await context.addCookies(
    cookies.map((c) => ({
      ...c,
      url: origin,
      sameSite: "Lax" as const,
      secure: origin.startsWith("https:"),
    })),
  );
  const page = await context.newPage();
  const bundle = await demoBundle();
  const template = bundle.notes[0],
    card = bundle.cards[0];
  bundle.notes = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => {
      const fields = [
        `A triangle has {{c1::three}} sides; a hexagon has {{c2::six}} sides.`,
        "",
      ];
      return {
        ...template,
        id: randomUUID(),
        originalId: String(1800000000000 + i),
        guid: `source-fixture-${i}`,
        fields,
        version: await hash(JSON.stringify(fields)),
      };
    }),
  );
  bundle.cards = bundle.notes.map((n, i) => ({
    ...card,
    id: randomUUID(),
    originalId: String(1800000000100 + i),
    noteId: n.id,
  }));
  bundle.report = { ...bundle.report, notes: 12, cards: 12, ready: 12 };
  const archive = await ankiContent(bundle);
  await page.goto(`${origin}/import`);
  await page.getByLabel("Choose Anki package").setInputFiles({
    name: "synthetic-source-practice.apkg",
    mimeType: "application/zip",
    buffer: Buffer.from(await archive.blob.arrayBuffer()),
  });
  await page
    .getByRole("button", { name: "Import 12 cards", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your deck is ready." }),
  ).toBeVisible();
  await page.goto(origin);
  await expect(page.getByRole("switch")).toBeEnabled();
  await expect(page.getByRole("switch")).not.toBeChecked();
  await page.getByRole("switch").check();
  await expect(page.getByText(/Starting sends selected text/)).toBeVisible();
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByTestId("card-face")).toBeVisible();
  const sessionId = page.url().split("/").at(-1)!;
  const rows = async (entity: string) =>
    (
      await pool.query(
        "SELECT value FROM public.documents WHERE owner_id=$1 AND entity=$2 AND deleted=false ORDER BY id",
        [owner, entity],
      )
    ).rows.map((r) => r.value);
  await expect
    .poll(
      async () =>
        (await rows("activities")).filter((a) => a.status === "source_bounded")
          .length,
      { timeout: 120000, intervals: [1000, 2000, 5000] },
    )
    .toBeGreaterThan(0);
  for (let i = 0; i < 10; i++) {
    await page.getByRole("button", { name: /Show answer/ }).click();
    await page.getByRole("button", { name: /^Easy/ }).click();
    if (i < 9)
      await expect(
        page.getByText(`${i + 1} reviewed`, { exact: false }),
      ).toBeVisible();
  }
  await expect(
    page.getByText("AI-GENERATED · UNVERIFIED", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const before = await page.evaluate(async (owner) => {
    const r = indexedDB.open(`recall-v1-${owner}`);
    const db = await new Promise<IDBDatabase>((resolve) => {
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction("states");
    const states = await new Promise<any[]>((resolve) => {
      const q = tx.objectStore("states").getAll();
      q.onsuccess = () => resolve(q.result);
    });
    db.close();
    return states;
  }, owner);
  await page.getByLabel("Your answer", { exact: true }).fill("three");
  await page.getByRole("button", { name: "Check my answer" }).click();
  await expect(page.getByText(/uncertain ·/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request rubric feedback" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "I need more practice" }).click();
  await page.getByText("Source support", { exact: true }).click();
  await expect(page.locator(".source-excerpt")).toBeVisible();
  await page.screenshot({
    path: "test-results/sanjeev-live-ai.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Report question", exact: true })
    .click();
  await page.getByRole("button", { name: "Turn off", exact: true }).click();
  await page.goto(`${origin}/account`);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect
    .poll(async () => (await rows("attempts")).length, { timeout: 60000 })
    .toBe(1);
  expect((await rows("reviews")).length).toBe(10);
  const states = await rows("states");
  expect(states.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    before.sort((a, b) => a.id.localeCompare(b.id)),
  );
  const attempts = await rows("attempts");
  expect(attempts[0]).toMatchObject({
    contaminated: true,
    grade: "uncertain",
    adjudication: "needs more practice",
  });
  expect(
    (await rows("activities")).find((a) => a.id === attempts[0].activityId)
      ?.status,
  ).toBe("quarantined");
  const jobs = (
    await pool.query(
      "SELECT id,status,input FROM public.jobs WHERE owner_id=$1 ORDER BY created_at",
      [owner],
    )
  ).rows;
  const first = jobs.find((j) => j.input.mode === "source_practice");
  expect(first.status).toBe("succeeded");
  const denied = await context.request.post(`${origin}/api/source-practice`, {
    headers: { origin },
    data: {
      sessionId,
      noteId: first.input.noteId,
      consent: true,
      variant: first.input.variant,
    },
  });
  expect(denied.status()).toBe(403);
  const result = {
    at: new Date().toISOString(),
    origin,
    imported: 12,
    originalReviews: 10,
    sourceAttempts: 1,
    provider: (await rows("activities"))[0].modelVersion,
    unreviewedLabel: true,
    sourceReferences: true,
    reportQuarantined: true,
    noScheduleCredit: true,
    revokedConsentBlocksRequests: true,
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/source-practice-smoke.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  if (owner) {
    const result = await admin.auth.admin.deleteUser(owner);
    if (result.error)
      console.error("Synthetic account cleanup needs attention", owner);
  }
  await pool.end();
}
