import { hash, type StudySession } from "@recall/domain";
import {
  SOURCE_PRACTICE_VERSION,
  sourceUnits,
  sourceVariants,
  type SourceVariant,
} from "@recall/learning";
import { transaction } from "./database";
import { HttpError } from "./auth";
export async function enqueueSourcePractice(
  owner: string,
  input: {
    noteId: string;
    sessionId: string;
    consent: true;
    variant: SourceVariant;
  },
) {
  if (
    process.env.ENABLE_SOURCE_PRACTICE !== "true" ||
    process.env.ENABLE_AI_GENERATION !== "true" ||
    process.env.ENABLE_ADAPTIVE_PRACTICE !== "true"
  )
    throw new HttpError(
      403,
      "GENERATION_DISABLED",
      "AI questions are unavailable. Continue regular review.",
    );
  return transaction(owner, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      owner,
    ]);
    const session = (
      await db.query(
        "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='sessions' AND id=$2 AND deleted=false",
        [owner, input.sessionId],
      )
    ).rows[0]?.value as StudySession | undefined;
    if (
      !input.consent ||
      !session?.aiQuestions ||
      session.completed ||
      session.budgetMinutes < 5
    )
      throw new HttpError(
        403,
        "CONSENT_REQUIRED",
        "Turn on AI questions before starting a timed session.",
      );
    const note = (
      await db.query(
        "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='notes' AND id=$2 AND deleted=false",
        [owner, input.noteId],
      )
    ).rows[0]?.value;
    if (
      !note ||
      !sourceUnits(note).length ||
      !sourceVariants(note).includes(input.variant)
    )
      throw new HttpError(
        422,
        "SOURCE_UNSUPPORTED",
        "This note cannot support that exercise. Continue regular review.",
      );
    const inDeck = (
      await db.query(
        "SELECT id FROM public.documents WHERE owner_id=$1 AND entity='cards' AND deleted=false AND value->>'noteId'=$2 AND ($3='' OR value->>'deckId'=$3) LIMIT 1",
        [owner, input.noteId, session.deckId],
      )
    ).rows.length;
    if (!inDeck)
      throw new HttpError(
        403,
        "SOURCE_OUTSIDE_SESSION",
        "Select a note from the session deck.",
      );
    const reported = (
      await db.query(
        "SELECT id FROM public.documents WHERE owner_id=$1 AND entity='activities' AND deleted=false AND value->>'status' IN ('quarantined','rejected') AND value->'sources' @> $2::jsonb LIMIT 1",
        [owner, JSON.stringify([{ noteId: note.id, version: note.version }])],
      )
    ).rows.length;
    if (reported)
      throw new HttpError(
        409,
        "SOURCE_REPORTED",
        "This source has a reported question. Continue regular review while it is checked.",
      );
    const key = await hash(
      JSON.stringify({
        session: session.id,
        note: note.id,
        version: note.version,
        variant: input.variant,
        policy: SOURCE_PRACTICE_VERSION,
      }),
    );
    const prior = (
      await db.query(
        "SELECT id,status FROM public.jobs WHERE owner_id=$1 AND idempotency_key=$2",
        [owner, key],
      )
    ).rows[0];
    if (prior) return prior;
    const counts = (
      await db.query(
        "SELECT count(*) FILTER (WHERE created_at>now()-interval '1 day') total,count(*) FILTER (WHERE input->>'sessionId'=$2) session FROM public.jobs WHERE owner_id=$1",
        [owner, session.id],
      )
    ).rows[0];
    if (Number(counts.total) >= 30 || Number(counts.session) >= 3)
      throw new HttpError(
        429,
        "DAILY_QUOTA",
        "AI question limit reached. Regular review is still available.",
      );
    return (
      await db.query(
        "INSERT INTO public.jobs(owner_id,kind,idempotency_key,input,max_attempts) VALUES($1,'generate',$2,$3,1) RETURNING id,status",
        [
          owner,
          key,
          JSON.stringify({
            mode: "source_practice",
            sessionId: session.id,
            consent: true,
            noteId: note.id,
            version: note.version,
            variant: input.variant,
          }),
        ],
      )
    ).rows[0];
  });
}
