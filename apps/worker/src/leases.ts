import type { Pool, PoolClient } from "pg";
/** Lease and cancellation checks share a transaction with publication of results. */
export async function publishWithLease<T>(
  pool: Pool,
  job: { id: string; lease_token: string },
  publish: (db: PoolClient) => Promise<T>,
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const current = (
      await db.query(
        "SELECT status,lease_token,lease_until FROM public.jobs WHERE id=$1 FOR UPDATE",
        [job.id],
      )
    ).rows[0];
    if (
      !current ||
      current.status !== "running" ||
      current.lease_token !== job.lease_token ||
      new Date(current.lease_until).getTime() <= Date.now()
    )
      throw new Error("CANCELLED");
    const result = await publish(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
