import { hash, type Activity } from "@recall/domain";
import { transaction } from "./database";
import { HttpError } from "./auth";
export async function enqueueGeneration(
  owner: string,
  noteId: string,
  task: Activity["cognitiveTask"],
  format: Activity["format"] = "short_answer",
) {
  if (process.env.ENABLE_AI_GENERATION !== "true")
    throw new HttpError(
      403,
      "GENERATION_DISABLED",
      "AI generation is disabled for this deployment.",
    );
  return transaction(owner, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      owner,
    ]);
    const prefs = (
      await db.query(
        "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='preferences' AND id='preferences'",
        [owner],
      )
    ).rows[0]?.value;
    if (!prefs?.aiConsent)
      throw new HttpError(
        403,
        "CONSENT_REQUIRED",
        "Enable selected-source AI processing in Settings before requesting generation.",
      );
    const note = (
      await db.query(
        "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='notes' AND id=$2 AND deleted=false",
        [owner, noteId],
      )
    ).rows[0]?.value;
    if (!note)
      throw new HttpError(
        404,
        "SOURCE_NOT_FOUND",
        "This source note is not available.",
      );
    const count = Number(
      (
        await db.query(
          "SELECT count(*) FROM public.jobs WHERE owner_id=$1 AND created_at>now()-interval '1 day'",
          [owner],
        )
      ).rows[0].count,
    );
    if (count >= 30)
      throw new HttpError(
        429,
        "DAILY_QUOTA",
        "The daily generation request quota has been reached.",
      );
    const key = await hash(
      JSON.stringify({
        noteId,
        version: note.version,
        task,
        format,
        prompt: "source-only-1",
        model: process.env.LLM_MODEL ?? "fixture",
      }),
    );
    const result = await db.query(
      "INSERT INTO public.jobs(owner_id,kind,idempotency_key,input,max_attempts) VALUES ($1,'generate',$2,$3,1) ON CONFLICT(owner_id,idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING id,status",
      [
        owner,
        key,
        JSON.stringify({ noteId, version: note.version, task, format }),
      ],
    );
    return result.rows[0];
  });
}
