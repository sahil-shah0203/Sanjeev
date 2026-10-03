import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
export async function testDatabase(owners: string[]) {
  const db = new PGlite();
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid primary key);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);CREATE TABLE storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$SELECT string_to_array($1,'/')$$;GRANT USAGE ON SCHEMA storage TO authenticated;GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;`,
  );
  for (const owner of owners)
    await db.query("INSERT INTO auth.users VALUES($1)", [owner]);
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  return db;
}
