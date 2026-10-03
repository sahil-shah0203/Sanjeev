import { beforeAll, afterAll, it, expect } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { testDatabase } from "./helpers/postgres";
import { publishWithLease } from "../apps/worker/src/leases";
import { id } from "@recall/domain";
let db: PGlite;
const owner = id();
beforeAll(async () => {
  db = await testDatabase([owner]);
});
afterAll(async () => {
  await db.close();
});
const pool = {
  connect: async () => ({
    query: (query: string, params?: unknown[]) => db.query(query, params),
    release: () => {},
  }),
} as unknown as Pool;
it("claims a job only once while its lease is live and prevents stale publication after cancellation", async () => {
  const jobId = id();
  await db.query(
    "INSERT INTO jobs(id,owner_id,kind,idempotency_key,input,max_attempts) VALUES($1,$2,'generate',$3,'{}',1)",
    [jobId, owner, id()],
  );
  const token = id();
  const claimed = await db.query<any>("SELECT * FROM claim_recall_job($1)", [
    token,
  ]);
  expect(claimed.rows).toHaveLength(1);
  expect(
    (await db.query("SELECT * FROM claim_recall_job($1)", [id()])).rows,
  ).toHaveLength(0);
  await publishWithLease(pool, { id: jobId, lease_token: token }, (client) =>
    client.query("UPDATE jobs SET output='{\"published\":true}' WHERE id=$1", [
      jobId,
    ]),
  );
  await db.query("UPDATE jobs SET status='cancel_requested' WHERE id=$1", [
    jobId,
  ]);
  await expect(
    publishWithLease(pool, { id: jobId, lease_token: token }, (client) =>
      client.query(
        "UPDATE jobs SET output='{\"published\":false}' WHERE id=$1",
        [jobId],
      ),
    ),
  ).rejects.toThrow("CANCELLED");
  expect(
    (await db.query<any>("SELECT output FROM jobs WHERE id=$1", [jobId]))
      .rows[0].output.published,
  ).toBe(true);
});
it("rejects expired and wrong leases and does not automatically repeat a one-attempt paid job", async () => {
  const jobId = id();
  await db.query(
    "INSERT INTO jobs(id,owner_id,kind,idempotency_key,input,max_attempts) VALUES($1,$2,'generate',$3,'{}',1)",
    [jobId, owner, id()],
  );
  const token = id();
  await db.query("SELECT * FROM claim_recall_job($1)", [token]);
  await expect(
    publishWithLease(pool, { id: jobId, lease_token: id() }, async () => {}),
  ).rejects.toThrow("CANCELLED");
  await db.query(
    "UPDATE jobs SET lease_until=now()-interval '1 minute' WHERE id=$1",
    [jobId],
  );
  await expect(
    publishWithLease(pool, { id: jobId, lease_token: token }, async () => {}),
  ).rejects.toThrow("CANCELLED");
  expect(
    (await db.query("SELECT * FROM claim_recall_job($1)", [id()])).rows,
  ).toHaveLength(0);
});
