import "fake-indexeddb/auto";
import { beforeAll, afterAll, it, expect, vi, afterEach } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { testDatabase } from "./helpers/postgres";
import { id, hash } from "@recall/domain";
import { mediaRecoveryCandidates } from "../apps/web/lib/server/media-recovery";
import { recoverCardMedia } from "../apps/web/features/media-recovery";
import { Library } from "../apps/web/lib/db/local";
let pg: PGlite;
const owner = id(),
  other = id(),
  target = id(),
  donor = id(),
  unrelated = id();
beforeAll(async () => {
  pg = await testDatabase([owner, other]);
  for (const [account, namespace, packageHash] of [
    [owner, target, "a".repeat(64)],
    [owner, donor, "a".repeat(64)],
    [owner, unrelated, "b".repeat(64)],
    [other, donor, "a".repeat(64)],
  ]) {
    const importId = id();
    await pg.query(
      "INSERT INTO documents(owner_id,entity,id,value) VALUES($1,'imports',$2,$3)",
      [
        account,
        importId,
        JSON.stringify({ id: importId, namespace, hash: packageHash }),
      ],
    );
  }
});
afterAll(async () => {
  await pg?.close();
});
afterEach(() => vi.unstubAllGlobals());
it("limits duplicate media recovery to the same owner and exact package hash", async () => {
  for (const [account, namespace, name] of [
    [owner, donor, "same.png"],
    [owner, unrelated, "unrelated.png"],
    [other, donor, "private.png"],
  ])
    await pg.query(
      "INSERT INTO media_assets(owner_id,id,namespace,name,hash,size,mime,object_key,complete) VALUES($1,$2,$3,$4,$5,4,$6,$7,true)",
      [
        account,
        id(),
        namespace,
        name,
        "c".repeat(64),
        "image/png",
        `${account}/synthetic`,
      ],
    );
  const rows = await mediaRecoveryCandidates(
    pg as unknown as PoolClient,
    owner,
    target,
    ["same.png", "unrelated.png", "private.png"],
  );
  expect(rows.map((row) => row.name)).toEqual(["same.png"]);
  await pg.query(
    "INSERT INTO media_assets(owner_id,id,namespace,name,hash,size,mime,object_key,complete) VALUES($1,$2,$3,$4,$5,4,$6,$7,false)",
    [
      owner,
      id(),
      target,
      "same.png",
      "d".repeat(64),
      "image/png",
      `${owner}/conflict`,
    ],
  );
  expect(
    await mediaRecoveryCandidates(pg as unknown as PoolClient, owner, target, [
      "same.png",
    ]),
  ).toEqual([]);
});
it("verifies recovered bytes and saves media without changing review data", async () => {
  const db = new Library(id());
  try {
    const blob = new Blob(["synthetic"], { type: "image/png" });
    const asset = {
      id: id(),
      namespace: target,
      name: "same.png",
      mime: "image/png",
      hash: await hash(await blob.arrayBuffer()),
      size: blob.size,
      cloud: false,
      url: "https://storage.example/signed",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ assets: [asset] }))
        .mockResolvedValueOnce(new Response(blob)),
    );
    expect(await recoverCardMedia(db, target, ["same.png"])).toBe(1);
    expect((await db.media.get(asset.id))?.blob.type).toBe("image/png");
    expect(await db.states.count()).toBe(0);
    expect(await db.reviews.count()).toBe(0);
  } finally {
    await db.delete();
  }
});
it("rejects damaged downloads without saving them", async () => {
  const db = new Library(id());
  try {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            assets: [
              {
                id: id(),
                namespace: target,
                name: "same.png",
                mime: "image/png",
                hash: "c".repeat(64),
                size: 4,
                url: "https://storage.example/signed",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(new Response("wrong")),
    );
    await expect(recoverCardMedia(db, target, ["same.png"])).rejects.toThrow(
      "integrity",
    );
    expect(await db.media.count()).toBe(0);
  } finally {
    await db.delete();
  }
});
it("downloads in parallel and publishes no incomplete mask set", async () => {
  const db = new Library(id());
  try {
    const blob = new Blob(["synthetic"], { type: "image/png" }),
      digest = await hash(await blob.arrayBuffer());
    const assets = [0, 1, 2].map((index) => ({
      id: id(),
      namespace: target,
      name: `mask-${index}.png`,
      mime: "image/png",
      hash: digest,
      size: blob.size,
      cloud: false,
      url: `https://storage.example/${index}`,
    }));
    const releases: Array<() => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        path === "/api/media/resolve"
          ? Response.json({ assets })
          : new Promise<Response>((resolve) => {
              releases.push(() => resolve(new Response(blob)));
            }),
      ),
    );
    const pending = recoverCardMedia(
      db,
      target,
      assets.map((asset) => asset.name),
    );
    await vi.waitFor(() => expect(releases.length).toBe(3));
    releases[0]();
    releases[1]();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await db.media.count()).toBe(0);
    releases[2]();
    expect(await pending).toBe(3);
    expect(await db.media.count()).toBe(3);
  } finally {
    await db.delete();
  }
});
