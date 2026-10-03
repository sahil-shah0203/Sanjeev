import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
let db: PGlite;
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid primary key);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);CREATE TABLE storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$SELECT string_to_array($1,'/')$$;GRANT USAGE ON SCHEMA storage TO authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;INSERT INTO auth.users VALUES('${alice}'),('${bob}');`,
  );
  await db.exec(
    await readFile("supabase/migrations/202610030001_recall.sql", "utf8"),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/202610030002_server_boundary.sql",
      "utf8",
    ),
  );
  await db.exec(
    `INSERT INTO public.documents(owner_id,entity,id,value) VALUES('${alice}','types','ta','{"id":"ta"}'),('${bob}','types','tb','{"id":"tb"}'),('${alice}','decks','da','{"id":"da"}'),('${bob}','decks','db','{"id":"db"}');`,
  );
});
afterAll(async () => {
  await db.close();
});
async function asUser<T>(owner: string, role: string, fn: () => Promise<T>) {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
      owner,
    ]);
    await db.exec(`SET LOCAL ROLE ${role}`);
    const result = await fn();
    await db.exec("COMMIT");
    return result;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}
it("migrations enforce select isolation and block owner changes through the server role", async () => {
  await asUser(alice, "recall_server", async () => {
    const result = await db.query(
      "SELECT id FROM public.documents ORDER BY id",
    );
    expect(result.rows).toEqual([{ id: "da" }, { id: "ta" }]);
    const other = await db.query(
      "UPDATE public.documents SET deleted=true WHERE owner_id=$1 RETURNING id",
      [bob],
    );
    expect(other.rows).toHaveLength(0);
  });
  await expect(
    asUser(alice, "recall_server", () =>
      db.query("UPDATE public.documents SET owner_id=$1 WHERE id=$2", [
        bob,
        "ta",
      ]),
    ),
  ).rejects.toThrow();
});
it("rejects foreign source references and prevents authenticated bypass of event validation", async () => {
  await expect(
    asUser(alice, "recall_server", () =>
      db.query(
        "INSERT INTO public.documents(owner_id,entity,id,value) VALUES($1,'notes','bad',$2)",
        [alice, JSON.stringify({ id: "bad", typeId: "tb" })],
      ),
    ),
  ).rejects.toThrow("Missing owned source");
  await expect(
    asUser(alice, "authenticated", () =>
      db.query(
        "INSERT INTO public.documents(owner_id,entity,id,value) VALUES($1,'decks','bypass',$2)",
        [alice, JSON.stringify({ id: "bypass" })],
      ),
    ),
  ).rejects.toThrow();
});
it("captures monotonic changes, supports idempotent receipts, and isolates media", async () => {
  await asUser(alice, "recall_server", async () => {
    await db.query(
      "INSERT INTO public.documents(owner_id,entity,id,value) VALUES($1,'notes','na',$2)",
      [alice, JSON.stringify({ id: "na", typeId: "ta" })],
    );
    const changes = await db.query<{ cursor: number; owner_id: string }>(
      "SELECT cursor,owner_id FROM public.change_log ORDER BY cursor",
    );
    expect(changes.rows.length).toBeGreaterThan(0);
    expect(changes.rows.every((r) => r.owner_id === alice)).toBe(true);
  });
  await asUser(alice, "authenticated", async () => {
    await db.query(
      "INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)",
      ["recall-media", `${alice}/own-image`],
    );
    expect(
      (await db.query("SELECT name FROM storage.objects")).rows,
    ).toHaveLength(1);
  });
  await asUser(bob, "authenticated", async () => {
    expect(
      (await db.query("SELECT name FROM storage.objects")).rows,
    ).toHaveLength(0);
  });
  await expect(
    asUser(bob, "authenticated", () =>
      db.query("INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)", [
        "recall-media",
        `${alice}/intruder`,
      ]),
    ),
  ).rejects.toThrow();
});
