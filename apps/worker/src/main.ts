import { Pool } from "pg";
import { createServer } from "node:http";
import { id, type Activity, type Note } from "@recall/domain";
import { modelProvider } from "@recall/ai";
import {
  validateActivity,
  validSourceActivity,
  DECK_PRACTICE_VERSION,
} from "@recall/learning";
import { publishWithLease } from "./leases";

// Uses Node's built-in .env loader; never print credentials or source content.
try {
  process.loadEnvFile(".env");
} catch {}
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL in the worker environment or root .env.");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});
let stopping = false;
let lastContact = 0;
const health = createServer((_request, response) => {
  const healthy = !stopping && Date.now() - lastContact < 90000;
  response.writeHead(healthy ? 200 : 503, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(
    JSON.stringify({
      service: "recall-worker",
      status: healthy ? "ok" : "starting_or_disconnected",
    }),
  );
});
health.listen(Number(process.env.PORT ?? 3002), "0.0.0.0");
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
const log = (event: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, ...data, at: new Date().toISOString() }));
async function reserveBudget(owner: string, jobId: string, calls = 1) {
  if (process.env.LLM_PROVIDER === "fixture" || !process.env.LLM_PROVIDER)
    return;
  const limit = Number(process.env.LLM_DAILY_SPEND_LIMIT);
  const inputRate = Number(process.env.LLM_INPUT_USD_PER_MILLION),
    outputRate = Number(process.env.LLM_OUTPUT_USD_PER_MILLION);
  if (
    !Number.isFinite(limit) ||
    limit <= 0 ||
    !Number.isFinite(inputRate) ||
    inputRate <= 0 ||
    !Number.isFinite(outputRate) ||
    outputRate <= 0
  )
    throw new Error("SPEND_CONFIGURATION_REQUIRED");
  // Worst-case byte-based upper bound; no automatic paid retries.
  const reserve = (calls * (24000 * inputRate + 1800 * outputRate)) / 1e6;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('recall-model-budget',0))",
    );
    const prior = (
      await client.query("SELECT id FROM public.usage_ledger WHERE job_id=$1", [
        jobId,
      ])
    ).rows[0];
    if (prior) throw new Error("PAID_RETRY_BLOCKED");
    const total = Number(
      (
        await client.query(
          "SELECT coalesce(sum(reserved_usd),0) total FROM public.usage_ledger WHERE day=current_date",
        )
      ).rows[0].total,
    );
    if (total + reserve > limit) throw new Error("DAILY_SPEND_LIMIT");
    await client.query(
      "INSERT INTO public.usage_ledger(owner_id,job_id,reserved_usd) VALUES($1,$2,$3)",
      [owner, jobId, reserve],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
async function execute(job: any) {
  if (job.kind === "generate") {
    if (process.env.ENABLE_AI_GENERATION !== "true")
      throw new Error("GENERATION_DISABLED");
    const prefs = (
      await pool.query(
        "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='preferences' AND id='preferences'",
        [job.owner_id],
      )
    ).rows[0]?.value;
    const adaptive = job.input.mode === "deck_practice_v2";
    const bounded = job.input.mode === "source_practice" || adaptive;
    if (adaptive && process.env.ENABLE_DECK_PRACTICE !== "true")
      throw new Error("GENERATION_DISABLED");
    if (bounded) {
      if (process.env.ENABLE_SOURCE_PRACTICE !== "true")
        throw new Error("GENERATION_DISABLED");
      const s = (
        await pool.query(
          "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='sessions' AND id=$2 AND deleted=false",
          [job.owner_id, job.input.sessionId],
        )
      ).rows[0]?.value;
      if (!job.input.consent || !s?.aiQuestions || s.completed)
        throw new Error("CONSENT_REQUIRED");
    } else if (!prefs?.aiConsent) throw new Error("CONSENT_REQUIRED");
    const note = (
      await pool.query(
        "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='notes' AND id=$2 AND deleted=false",
        [job.owner_id, job.input.noteId],
      )
    ).rows[0]?.value as Note | undefined;
    if (!note || note.version !== job.input.version)
      throw new Error("SOURCE_CHANGED");
    const type = adaptive
      ? (
          await pool.query(
            "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='types' AND id=$2 AND deleted=false",
            [job.owner_id, note.typeId],
          )
        ).rows[0]?.value
      : undefined;
    const card = adaptive
      ? (
          await pool.query(
            "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='cards' AND id=$2 AND deleted=false",
            [job.owner_id, job.input.cardId],
          )
        ).rows[0]?.value
      : undefined;
    const review = adaptive
      ? (
          await pool.query(
            "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='reviews' AND id=$2 AND deleted=false",
            [job.owner_id, job.input.sourceContext?.reviewId],
          )
        ).rows[0]?.value
      : undefined;
    if (
      adaptive &&
      (!type ||
        card?.noteId !== note.id ||
        review?.cardId !== card.id ||
        review.contentVersion !== note.version ||
        ["undone", "concurrent"].includes(review.status))
    )
      throw new Error("SOURCE_CHANGED");
    await reserveBudget(job.owner_id, job.id, adaptive ? 2 : 1);
    const result = adaptive
      ? await modelProvider().deckPractice(
          note,
          type,
          card,
          job.input.variant,
          job.input.sourceContext,
        )
      : bounded
        ? await modelProvider().sourcePractice(note, job.input.variant)
        : await modelProvider().generate(
            [note],
            job.input.task,
            job.input.format,
          );
    if (result.activity) {
      const errors = validateActivity(result.activity, [note]);
      if (bounded && !validSourceActivity(result.activity, [note]))
        return { abstain: "Unsupported source exercise." };
      if (errors.length) return { abstain: errors.join(" ") };
      const a = {
        ...result.activity,
        status: bounded ? "source_bounded" : "draft",
      };
      await publishWithLease(pool, job, async (db) => {
        const current = (
          await db.query(
            "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='notes' AND id=$2 AND deleted=false FOR UPDATE",
            [job.owner_id, note.id],
          )
        ).rows[0]?.value;
        if (current?.version !== note.version)
          throw new Error("SOURCE_CHANGED");
        if (bounded) {
          const s = (
            await db.query(
              "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='sessions' AND id=$2 AND deleted=false FOR UPDATE",
              [job.owner_id, job.input.sessionId],
            )
          ).rows[0]?.value;
          if (!s?.aiQuestions || s.completed)
            throw new Error("CONSENT_REQUIRED");
          if (adaptive) {
            const sourceReview = (
              await db.query(
                "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='reviews' AND id=$2 AND deleted=false",
                [job.owner_id, job.input.sourceContext.reviewId],
              )
            ).rows[0]?.value;
            if (
              !sourceReview ||
              ["undone", "concurrent"].includes(sourceReview.status)
            )
              throw new Error("SOURCE_CHANGED");
          }
        }
        return db.query(
          "INSERT INTO public.documents(owner_id,entity,id,value) VALUES($1,'activities',$2,$3) ON CONFLICT(owner_id,entity,id) DO NOTHING",
          [job.owner_id, a.id, JSON.stringify(a)],
        );
      });
      return {
        activityId: a.id,
        status: bounded ? "source_bounded" : "awaiting_human_review",
      };
    }
    return result;
  }
  if (job.kind === "grade") {
    if (process.env.ENABLE_AI_GENERATION !== "true")
      throw new Error("GENERATION_DISABLED");
    const prefs = (
      await pool.query(
        "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='preferences' AND id='preferences'",
        [job.owner_id],
      )
    ).rows[0]?.value;
    const adaptive = job.input.mode === "deck_feedback_v2";
    if (!adaptive && !prefs?.aiConsent) throw new Error("CONSENT_REQUIRED");
    const attempt = (
      await pool.query(
        "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='attempts' AND id=$2",
        [job.owner_id, job.input.attemptId],
      )
    ).rows[0]?.value;
    const activity = (
      await pool.query(
        "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='activities' AND id=$2",
        [job.owner_id, attempt?.activityId],
      )
    ).rows[0]?.value as Activity | undefined;
    const s =
      adaptive && attempt
        ? (
            await pool.query(
              "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='sessions' AND id=$2 AND deleted=false",
              [job.owner_id, attempt.sessionId],
            )
          ).rows[0]?.value
        : undefined;
    const notes =
      adaptive && activity
        ? (
            await pool.query(
              "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='notes' AND id=$2 AND deleted=false",
              [job.owner_id, activity.sources[0].noteId],
            )
          ).rows.map((row) => row.value)
        : [];
    if (
      adaptive &&
      (process.env.ENABLE_DECK_PRACTICE !== "true" ||
        !s?.aiQuestions ||
        s.completed ||
        s.aiPolicy !== DECK_PRACTICE_VERSION ||
        !activity?.sourceRecipe?.generated ||
        !validSourceActivity(activity, notes))
    )
      throw new Error("CONSENT_REQUIRED");
    if (
      !attempt ||
      !activity ||
      (!adaptive &&
        (activity.status !== "human_approved" || activity.sourceRecipe)) ||
      activity.version !== attempt.activityVersion
    )
      throw new Error("APPROVED_ACTIVITY_REQUIRED");
    await reserveBudget(job.owner_id, job.id, adaptive ? 2 : 1);
    const grade = await modelProvider().grade(
      activity,
      String(attempt.answer).slice(0, 4000),
    );
    await publishWithLease(pool, job, async (db) => {
      const current = (
        await db.query(
          "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='activities' AND id=$2 AND deleted=false FOR UPDATE",
          [job.owner_id, activity.id],
        )
      ).rows[0]?.value;
      if (
        current?.status !== (adaptive ? "source_bounded" : "human_approved") ||
        current.version !== activity.version
      )
        throw new Error("APPROVED_ACTIVITY_REQUIRED");
      if (adaptive) {
        const session = (
          await db.query(
            "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='sessions' AND id=$2 AND deleted=false",
            [job.owner_id, attempt.sessionId],
          )
        ).rows[0]?.value;
        const note = (
          await db.query(
            "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='notes' AND id=$2 AND deleted=false",
            [job.owner_id, activity.sources[0].noteId],
          )
        ).rows[0]?.value;
        const answer = (
          await db.query(
            "SELECT value FROM public.documents WHERE owner_id=$1 AND entity='attempts' AND id=$2 AND deleted=false",
            [job.owner_id, attempt.id],
          )
        ).rows[0]?.value;
        if (
          !session?.aiQuestions ||
          session.completed ||
          !note ||
          !validSourceActivity(current, [note]) ||
          answer?.answer !== attempt.answer
        )
          throw new Error("SOURCE_CHANGED");
      }
      return db.query(
        "UPDATE public.documents SET value=value || $3::jsonb,row_version=row_version+1,updated_at=now() WHERE owner_id=$1 AND entity='attempts' AND id=$2",
        [job.owner_id, attempt.id, JSON.stringify({ modelGrade: grade })],
      );
    });
    return { attemptId: attempt.id, grade };
  }
  if (job.kind === "cleanup") {
    await pool.query(
      "UPDATE public.jobs SET status='failed',error_code='LEASE_RETRIES_EXHAUSTED' WHERE status='running' AND lease_until<now() AND attempts>=max_attempts",
    );
    return { complete: true };
  }
  throw new Error("UNSUPPORTED_JOB_TYPE");
}
log("worker_ready");
while (!stopping) {
  try {
    const token = id();
    const job = (
      await pool.query("SELECT * FROM public.claim_recall_job($1)", [token])
    ).rows[0];
    lastContact = Date.now();
    if (!job) {
      await pool.query(
        "UPDATE public.jobs SET status='failed',error_code='LEASE_RETRIES_EXHAUSTED',updated_at=now() WHERE status='running' AND lease_until<now() AND attempts>=max_attempts",
      );
      await pool.query(
        "UPDATE public.jobs SET status='cancelled',updated_at=now() WHERE status='cancel_requested' AND (lease_until IS NULL OR lease_until<now())",
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    log("job_started", { job: job.id, kind: job.kind });
    const heartbeat = setInterval(
      () =>
        void pool
          .query(
            "UPDATE public.jobs SET heartbeat_at=now(),lease_until=now()+interval '60 seconds' WHERE id=$1 AND lease_token=$2 AND status='running'",
            [job.id, token],
          )
          .catch(() => log("heartbeat_failed", { job: job.id })),
      15000,
    );
    try {
      const output = await execute(job);
      await pool.query(
        "UPDATE public.jobs SET status=CASE WHEN status='cancel_requested' THEN 'cancelled' ELSE 'succeeded' END,output=$3,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",
        [job.id, token, JSON.stringify(output)],
      );
      log("job_finished", { job: job.id });
    } catch (e) {
      const code =
        e instanceof Error && /^[A-Z_]+$/.test(e.message)
          ? e.message
          : "JOB_FAILED";
      await pool.query(
        "UPDATE public.jobs SET status=CASE WHEN status='cancel_requested' OR $3='CANCELLED' THEN 'cancelled' ELSE 'failed' END,error_code=$3,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",
        [job.id, token, code],
      );
      log("job_failed", { job: job.id, code });
    } finally {
      clearInterval(heartbeat);
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "UNKNOWN";
    log("database_unavailable", {
      code: /^[A-Z0-9_]{1,40}$/.test(code) ? code : "UNKNOWN",
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
health.close();
await pool.end();
log("worker_stopped");
