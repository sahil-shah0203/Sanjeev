import { Pool, type PoolClient } from "pg";
import { HttpError } from "./auth";
let pool: Pool | undefined;
export function database() {
  if (!process.env.DATABASE_URL)
    throw new HttpError(
      503,
      "DATABASE_NOT_CONFIGURED",
      "Cloud sync requires the server database connection to be configured.",
    );
  return (pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  }));
}
export async function transaction<T>(
  owner: string,
  fn: (db: PoolClient) => Promise<T>,
) {
  const db = await database().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      owner,
    ]);
    await db.query("SET LOCAL ROLE recall_server");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
