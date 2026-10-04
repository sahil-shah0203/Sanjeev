// Explicit live smoke: creates isolated synthetic accounts, sends no email,
// touches only their records, and removes those accounts/media on completion.
import { chromium, expect, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { syntheticPackage } from "../tests/helpers/anki";
try {
  process.loadEnvFile(".env");
} catch {}
const origin = process.env.SMOKE_ORIGIN;
if (!origin)
  throw new Error("Set SMOKE_ORIGIN to explicitly select the beta deployment.");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 15000,
});
const accounts: { id: string; email: string; password: string }[] = [];
const browser = await chromium.launch();
const result: Record<string, unknown> = {
  at: new Date().toISOString(),
  origin,
};
async function account() {
  const email = `recall-smoke-${randomUUID()}@example.com`,
    password = randomUUID() + randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: "recall-isolated-smoke" },
  });
  if (error || !data.user)
    throw new Error(`Synthetic account creation failed: ${error?.message}`);
  const value = { id: data.user.id, email, password };
  accounts.push(value);
  return value;
}
async function login(
  context: BrowserContext,
  user: Awaited<ReturnType<typeof account>>,
) {
  const cookies: { name: string; value: string }[] = [];
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => cookies,
      setAll: (updates) => {
        for (const c of updates) {
          const prior = cookies.find((v) => v.name === c.name);
          if (prior) prior.value = c.value;
          else cookies.push(c);
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw new Error(`Synthetic login failed: ${error.message}`);
  await context.addCookies(
    cookies.map(({ name, value }) => ({
      name,
      value,
      url: origin,
      sameSite: "Lax" as const,
      secure: origin!.startsWith("https:"),
    })),
  );
  return client;
}
async function rows(owner: string, entity: string) {
  return (
    await pool.query(
      "SELECT value FROM public.documents WHERE owner_id=$1 AND entity=$2 AND deleted=false",
      [owner, entity],
    )
  ).rows.map((r) => r.value);
}
try {
  const alice = await account(),
    bob = await account();
  const a = await browser.newContext(),
    b = await browser.newContext(),
    outsider = await browser.newContext();
  const page = await a.newPage();
  const file = await syntheticPackage(true);
  await page.goto(`${origin}/import`);
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
  await page.goto(origin);
  await page.getByRole("button", { name: "Start a session" }).click();
  await page.getByRole("button", { name: /Show answer/ }).click();
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect(page.getByText(/1 reviewed/)).toBeVisible();
  await login(a, alice);
  await page.goto(`${origin}/settings`);
  await page
    .getByRole("button", { name: "Bring guest library into this account" })
    .click();
  await expect(
    page.getByText(/Guest library copied and acknowledged/),
  ).toBeVisible({ timeout: 90000 });
  await expect
    .poll(async () => (await rows(alice.id, "cards")).length, {
      timeout: 30000,
    })
    .toBe(6);
  result.guestMigration =
    "6 cards and first review copied; guest recovery retained";
  await login(b, alice);
  const second = await b.newPage();
  await second.goto(`${origin}/settings`);
  await expect(
    second.getByText("Synced across your devices", { exact: true }).first(),
  ).toBeVisible({ timeout: 90000 });
  const local = async (contextPage: typeof second) =>
    contextPage.evaluate(async (owner) => {
      const req = indexedDB.open(`recall-v1-${owner}`);
      const db = await new Promise<IDBDatabase>((resolve) => {
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction([
        "cards",
        "states",
        "media",
        "reviews",
        "outbox",
      ]);
      const read = <T>(r: IDBRequest<T>) =>
        new Promise<T>((resolve) => {
          r.onsuccess = () => resolve(r.result);
        });
      const [cards, states, media, reviews, pending] = await Promise.all([
        read(tx.objectStore("cards").getAll()),
        read(tx.objectStore("states").getAll()),
        read(tx.objectStore("media").getAll()),
        read(tx.objectStore("reviews").getAll()),
        read(tx.objectStore("outbox").count()),
      ]);
      db.close();
      return {
        cards: cards.length,
        states,
        media: media.map((m) => ({
          id: m.id,
          hash: m.hash,
          bytes: m.blob.size,
          cloud: m.cloud,
        })),
        reviews: reviews.length,
        pending,
      };
    }, alice.id);
  const stateA = await local(page),
    stateB = await local(second);
  expect(stateB.cards).toBe(6);
  expect(stateB.reviews).toBe(1);
  expect(stateB.media).toEqual(stateA.media);
  expect(stateB.states).toEqual(stateA.states);
  expect(stateB.media).toHaveLength(1);
  expect(stateB.media[0].bytes).toBeGreaterThan(0);
  result.crossDevice =
    "Matching card states, review head, and verified private media";
  await b.setOffline(true);
  await second.goto(origin);
  await second.getByRole("button", { name: "Start a session" }).click();
  await second.getByRole("button", { name: /Show answer/ }).click();
  await second.getByRole("button", { name: /^Good/ }).click();
  await expect(second.getByText(/1 reviewed/)).toBeVisible();
  await second.reload();
  await expect(second.getByText(/1 reviewed/)).toBeVisible();
  await b.setOffline(false);
  await second.goto(`${origin}/settings`);
  await second.getByRole("button", { name: "Sync now" }).click();
  await expect
    .poll(async () => (await local(second)).pending, { timeout: 60000 })
    .toBe(0);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect
    .poll(async () => (await local(page)).reviews, { timeout: 60000 })
    .toBe(2);
  expect((await local(page)).states).toEqual((await local(second)).states);
  result.offlineSync =
    "Offline answer survives reload and reaches the other browser once";
  const bobClient = await login(outsider, bob);
  const tenantRead = await bobClient
    .from("documents")
    .select("id")
    .eq("owner_id", alice.id);
  if (tenantRead.error) throw new Error("Live RLS probe could not run");
  expect(tenantRead.data).toEqual([]);
  const denied = await outsider.request.post(`${origin}/api/media/download`, {
    headers: { origin },
    data: { id: stateA.media[0].id },
  });
  expect(denied.status()).toBe(404);
  result.tenantIsolation =
    "Other authenticated account cannot read source documents or request private media";
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/cloud-smoke.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  for (const user of accounts) {
    const media = (
      await pool.query(
        "SELECT object_key FROM public.media_assets WHERE owner_id=$1",
        [user.id],
      )
    ).rows;
    if (media.length) {
      const cleanup = await admin.storage
        .from("recall-media")
        .remove(media.map((r) => r.object_key));
      if (cleanup.error)
        console.error(
          "Synthetic media cleanup needs attention for account",
          user.id,
        );
    }
    const deleted = await admin.auth.admin.deleteUser(user.id);
    if (deleted.error)
      console.error("Synthetic account cleanup needs attention", user.id);
  }
  await pool.end();
}
