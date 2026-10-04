import { NextResponse } from "next/server";
import { z } from "zod";
import { identity, body, failure, HttpError } from "../../../lib/server/auth";
import { transaction } from "../../../lib/server/database";
export async function POST(request: Request) {
  try {
    const { user } = await identity(request);
    const { attemptId } = z
      .object({ attemptId: z.string().uuid() })
      .parse(await body(request, 2048));
    if (process.env.ENABLE_AI_GENERATION !== "true")
      throw new HttpError(
        403,
        "AI_DISABLED",
        "Semantic grading is disabled. Use the self-check.",
      );
    const job = await transaction(user.id, async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        user.id,
      ]);
      const preferences = (
        await db.query(
          "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='preferences' AND id='preferences'",
          [user.id],
        )
      ).rows[0]?.value;
      if (!preferences?.aiConsent)
        throw new HttpError(
          403,
          "CONSENT_REQUIRED",
          "Enable selected-source processing before requesting model feedback.",
        );
      const existing = (
        await db.query(
          "SELECT id,status FROM public.jobs WHERE owner_id=$1 AND idempotency_key=$2",
          [user.id, `grade:${attemptId}`],
        )
      ).rows[0];
      if (existing) return existing;
      const count = Number(
        (
          await db.query(
            "SELECT count(*) FROM public.jobs WHERE owner_id=$1 AND created_at>now()-interval '1 day'",
            [user.id],
          )
        ).rows[0].count,
      );
      if (count >= 30)
        throw new HttpError(
          429,
          "DAILY_QUOTA",
          "The daily model request quota has been reached.",
        );
      const attempt = (
        await db.query(
          "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='attempts' AND id=$2",
          [user.id, attemptId],
        )
      ).rows[0];
      if (!attempt)
        throw new HttpError(
          404,
          "ATTEMPT_MISSING",
          "Sync the saved answer before requesting a grade.",
        );
      const activity = (
        await db.query(
          "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='activities' AND id=$2 AND deleted=false",
          [user.id, attempt.value.activityId],
        )
      ).rows[0]?.value;
      if (
        !activity ||
        activity.status !== "human_approved" ||
        activity.sourceRecipe
      )
        throw new HttpError(
          403,
          "APPROVED_ACTIVITY_REQUIRED",
          "Source exercises use self-check only. No model grade is requested.",
        );
      return (
        await db.query(
          "INSERT INTO public.jobs(owner_id,kind,idempotency_key,input,max_attempts) VALUES($1,'grade',$2,$3,1) ON CONFLICT(owner_id,idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING id,status",
          [user.id, `grade:${attemptId}`, JSON.stringify({ attemptId })],
        )
      ).rows[0];
    });
    return NextResponse.json(job, { status: 202 });
  } catch (e) {
    return failure(e);
  }
}
