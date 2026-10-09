import { NextResponse } from "next/server";
import { z } from "zod";
import { hash, id as newId } from "@recall/domain";
import { mediaRecoveryCandidates } from "../../../../lib/server/media-recovery";
import {
  identity,
  body,
  failure,
  HttpError,
} from "../../../../lib/server/auth";
import { transaction } from "../../../../lib/server/database";
import { adminStorage } from "../../../../lib/server/media";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { user } = await identity(request);
    const { action } = await params;
    const input = await body(request, action === "resolve" ? 48 * 1024 : 8192);
    const store = adminStorage().storage.from("recall-media");
    if (action === "resolve") {
      const { namespace, names } = z
        .object({
          namespace: z.string().uuid(),
          names: z.array(z.string().min(1).max(1024)).min(1).max(32),
        })
        .parse(input);
      const rows = await transaction(user.id, (db) =>
        mediaRecoveryCandidates(db, user.id, namespace, names),
      );
      if (!rows.length) return NextResponse.json({ assets: [] });
      const { data, error } = await store.createSignedUrls(
        rows.map((row) => row.object_key),
        120,
      );
      if (error || !data) throw new Error("Download ticket failed");
      const tickets = new Map(
        data.map((ticket) => [ticket.path, ticket.signedUrl]),
      );
      const assets = rows.map((row) => {
        const url = tickets.get(row.object_key);
        if (!url) throw new Error("Download ticket failed");
        return {
          id: row.target_id ?? newId(),
          namespace,
          name: row.name,
          hash: row.hash,
          size: Number(row.size),
          mime: row.mime,
          cloud: !!row.target_complete,
          url,
        };
      });
      return NextResponse.json({ assets });
    }
    if (action === "upload") {
      const m = z
        .object({
          id: z.string().uuid(),
          namespace: z.string().uuid(),
          name: z.string().max(1024),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
          size: z
            .number()
            .int()
            .min(0)
            .max(64 * 1024 ** 2),
          mime: z.string().max(100),
        })
        .parse(input);
      const key = `${user.id}/${m.hash}`;
      const row = await transaction(user.id, async (db) => {
        const existing = (
          await db.query(
            "SELECT * FROM public.media_assets WHERE owner_id=$1 AND id=$2",
            [user.id, m.id],
          )
        ).rows[0];
        if (existing && existing.hash !== m.hash)
          throw new HttpError(
            409,
            "MEDIA_CONFLICT",
            "The media identifier already refers to different content.",
          );
        await db.query(
          "INSERT INTO public.media_assets(owner_id,id,namespace,name,hash,size,mime,object_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(owner_id,id) DO NOTHING",
          [user.id, m.id, m.namespace, m.name, m.hash, m.size, m.mime, key],
        );
        return existing;
      });
      if (row?.complete) return NextResponse.json({ complete: true });
      const { data, error } = await store.createSignedUploadUrl(key, {
        upsert: true,
      });
      if (error) throw new Error("Storage ticket failed");
      return NextResponse.json({ url: data.signedUrl });
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(input);
    const row = await transaction(
      user.id,
      async (db) =>
        (
          await db.query(
            "SELECT * FROM public.media_assets WHERE owner_id=$1 AND id=$2",
            [user.id, id],
          )
        ).rows[0],
    );
    if (!row)
      throw new HttpError(
        404,
        "MEDIA_NOT_FOUND",
        "This media asset is not available.",
      );
    if (action === "complete") {
      const { data, error } = await store.download(row.object_key);
      if (
        error ||
        !data ||
        data.size !== Number(row.size) ||
        (await hash(await data.arrayBuffer())) !== row.hash
      )
        throw new HttpError(
          400,
          "MEDIA_INTEGRITY_FAILED",
          "The uploaded media did not match its declared content.",
        );
      await transaction(user.id, (db) =>
        db.query(
          "UPDATE public.media_assets SET complete=true WHERE owner_id=$1 AND id=$2",
          [user.id, id],
        ),
      );
      return NextResponse.json({ complete: true });
    }
    if (action === "download") {
      if (!row.complete)
        throw new HttpError(
          409,
          "MEDIA_PENDING",
          "This media file has not finished uploading.",
        );
      const { data, error } = await store.createSignedUrl(row.object_key, 120);
      if (error) throw new Error("Download ticket failed");
      return NextResponse.json({ url: data.signedUrl });
    }
    throw new HttpError(404, "NOT_FOUND", "Unknown media action.");
  } catch (e) {
    return failure(e);
  }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { user } = await identity();
    if ((await params).action !== "list")
      throw new HttpError(404, "NOT_FOUND", "Unknown media action.");
    const cursor = new URL(request.url).searchParams.get("cursor") ?? "";
    if (cursor && !z.string().uuid().safeParse(cursor).success)
      throw new HttpError(400, "INVALID_CURSOR", "Invalid media cursor.");
    const rows = await transaction(
      user.id,
      async (db) =>
        (
          await db.query(
            "SELECT id,namespace,name,hash,size,mime FROM public.media_assets WHERE owner_id=$1 AND complete=true AND ($2::text='' OR id::text>$2) ORDER BY id LIMIT 101",
            [user.id, cursor],
          )
        ).rows,
    );
    return NextResponse.json({
      assets: rows.slice(0, 100).map((r) => ({ ...r, size: Number(r.size) })),
      nextCursor: rows.length > 100 ? rows[99].id : null,
    });
  } catch (e) {
    return failure(e);
  }
}
