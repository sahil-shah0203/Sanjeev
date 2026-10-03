import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ActivitySchema,
  hash,
  id,
  stableJson,
  type Note,
} from "@recall/domain";
import { validateActivity } from "@recall/learning";
import { identity, body, failure, HttpError } from "../../../lib/server/auth";
import { transaction } from "../../../lib/server/database";
async function authorize(reviewer: string, owner: string) {
  const scopes = await transaction(
    reviewer,
    async (db) =>
      (
        await db.query(
          "SELECT owner_id FROM public.reviewer_scopes WHERE reviewer_id=$1 AND owner_id=$2",
          [reviewer, owner],
        )
      ).rows,
  );
  if (!scopes.length)
    throw new HttpError(
      403,
      "REVIEWER_SCOPE_REQUIRED",
      "A qualified reviewer must be assigned access to this collection by the deployment owner.",
    );
}
export async function PUT(request: Request) {
  try {
    const { user } = await identity(request);
    const input = z
      .object({
        owner: z.uuid(),
        reportId: z.string().min(1),
        comment: z.string().min(3).max(2000),
      })
      .parse(await body(request, 4096));
    await authorize(user.id, input.owner);
    await transaction(input.owner, async (db) => {
      const row = (
        await db.query(
          "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='reports' AND id=$2 FOR UPDATE",
          [input.owner, input.reportId],
        )
      ).rows[0];
      if (!row)
        throw new HttpError(
          404,
          "REPORT_MISSING",
          "This report is unavailable.",
        );
      await db.query(
        "UPDATE public.documents SET value=value || '{\"status\":\"resolved\"}'::jsonb,row_version=row_version+1,updated_at=now() WHERE owner_id=$1 AND entity='reports' AND id=$2",
        [input.owner, input.reportId],
      );
      await db.query(
        "INSERT INTO public.content_audits(owner_id,reviewer_id,activity_id,action,content_hash,comment) VALUES($1,$2,$3,$4,$5,$6)",
        [
          input.owner,
          user.id,
          row.value.activityId ?? `card:${row.value.cardId}`,
          "resolve_report",
          await hash(stableJson(row.value)),
          input.comment,
        ],
      );
    });
    return NextResponse.json({ resolved: true });
  } catch (error) {
    return failure(error);
  }
}
export async function GET(request: Request) {
  try {
    const { user } = await identity();
    const owner = new URL(request.url).searchParams.get("owner") ?? user.id;
    await authorize(user.id, owner);
    return NextResponse.json(
      await transaction(owner, async (db) => {
        const activities = (
          await db.query(
            "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='activities' AND deleted=false ORDER BY updated_at DESC LIMIT 100",
            [owner],
          )
        ).rows.map((r) => r.value);
        const ids = [
          ...new Set(
            activities.flatMap((a) => a.sources.map((s: any) => s.noteId)),
          ),
        ];
        const notes = ids.length
          ? (
              await db.query(
                "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='notes' AND id=ANY($2::text[])",
                [owner, ids],
              )
            ).rows.map((r) => r.value)
          : [];
        const reports = (
          await db.query(
            "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='reports' AND deleted=false ORDER BY updated_at DESC LIMIT 100",
            [owner],
          )
        ).rows.map((r) => r.value);
        return { activities, notes, owner, reports };
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const { user } = await identity(request);
    const input = z
      .object({
        owner: z.string().uuid(),
        action: z.enum(["draft", "approve", "reject", "quarantine"]),
        activity: ActivitySchema,
        comment: z.string().max(2000),
      })
      .parse(await body(request, 128 * 1024));
    await authorize(user.id, input.owner);
    const result = await transaction(input.owner, async (db) => {
      let a = input.activity;
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        input.owner,
      ]);
      const existing = (
        await db.query(
          "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='activities' AND id=$2 FOR UPDATE",
          [input.owner, a.id],
        )
      ).rows[0]?.value;
      const content = (value: any) => {
        const { status, approvedHash, reviewerId, id, version, ...rest } =
          value;
        return stableJson(rest);
      };
      if (existing && content(existing) !== content(a)) {
        await db.query(
          "UPDATE public.documents SET value=value || '{\"status\":\"quarantined\"}'::jsonb,row_version=row_version+1,updated_at=now() WHERE owner_id=$1 AND entity='activities' AND id=$2",
          [input.owner, a.id],
        );
        a = { ...a, id: id(), version: id() };
      }
      const ids = [...new Set(a.sources.map((s) => s.noteId))];
      const notes = (
        await db.query(
          "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='notes' AND id=ANY($2::text[])",
          [input.owner, ids],
        )
      ).rows.map((r) => r.value as Note);
      const errors = validateActivity(a, notes);
      if (input.action === "approve" && errors.length)
        throw new HttpError(400, "CONTENT_INVALID", errors.join(" "));
      const { approvedHash: oldHash, reviewerId: oldReviewer, ...base } = a;
      const candidate = {
        ...base,
        status:
          input.action === "approve"
            ? "human_approved"
            : input.action === "reject"
              ? "rejected"
              : input.action === "quarantine"
                ? "quarantined"
                : "draft",
      };
      const contentHash = await hash(stableJson(candidate));
      const final = {
        ...candidate,
        reviewerId: input.action === "approve" ? user.id : undefined,
        approvedHash: input.action === "approve" ? contentHash : undefined,
      };
      await db.query(
        "INSERT INTO public.documents(owner_id,entity,id,value) VALUES ($1,'activities',$2,$3) ON CONFLICT(owner_id,entity,id) DO UPDATE SET value=EXCLUDED.value,row_version=documents.row_version+1,updated_at=now()",
        [input.owner, a.id, JSON.stringify(final)],
      );
      await db.query(
        "INSERT INTO public.content_audits(owner_id,reviewer_id,activity_id,action,content_hash,comment) VALUES ($1,$2,$3,$4,$5,$6)",
        [input.owner, user.id, a.id, input.action, contentHash, input.comment],
      );
      return final;
    });
    return NextResponse.json(result);
  } catch (e) {
    return failure(e);
  }
}
