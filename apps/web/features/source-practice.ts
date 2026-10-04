import { type Activity, type Note, now } from "@recall/domain";
import {
  sourceUnits,
  sourceVariants,
  sourceBudgetFits,
  validSourceActivity,
} from "@recall/learning";
import { Library, enqueue } from "../lib/db/local";
import { syncLibrary } from "./sync";

/** Durable slot reservation prevents React remounts/reloads from sending duplicate requests. */
export async function prepareSourcePractice(
  db: Library,
  sessionId: string,
  note: Note,
  signal: AbortSignal,
) {
  const session = await db.sessions.get(sessionId);
  if (
    !session?.aiQuestions ||
    session.completed ||
    !sourceUnits(note).length ||
    !navigator.onLine
  )
    return;
  const slot = Math.floor(session.reviews / 10);
  if (slot >= 3) return;
  const previous = (await db.activities.toArray()).filter(
    (a) =>
      a.sourceRecipe &&
      a.sources.some((s) => s.noteId === note.id && s.version === note.version),
  );
  if (previous.some((a) => ["quarantined", "rejected"].includes(a.status)))
    return;
  const variants = sourceVariants(note);
  const variant = variants[(previous.length + slot) % variants.length];
  const reserved = await db.transaction(
    "rw",
    db.meta,
    db.sessions,
    db.outbox,
    async () => {
      const key = `source-request:${sessionId}:${slot}`;
      if (await db.meta.get(key)) return false;
      const current = await db.sessions.get(sessionId);
      if (
        !current?.aiQuestions ||
        current.completed ||
        (current.aiRequests ?? 0) >= 3
      )
        return false;
      await db.meta.put({
        id: key,
        value: { noteId: note.id, variant, at: now() },
      });
      const updated = {
        ...current,
        aiRequests: (current.aiRequests ?? 0) + 1,
        updatedAt: now(),
      };
      await db.sessions.put(updated);
      await enqueue(db, "sessions", sessionId, updated);
      return true;
    },
  );
  if (!reserved) return;
  await syncLibrary(db, () => {});
  if (signal.aborted) return;
  const current = await db.sessions.get(sessionId);
  if (!current?.aiQuestions || current.completed) return;
  const response = await fetch("/api/source-practice", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      noteId: note.id,
      variant,
      consent: true,
    }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error?.message ??
        "AI questions are unavailable. Continue your review.",
    );
  const deadline = Date.now() + 65000;
  while (!signal.aborted && Date.now() < deadline) {
    const jobResponse = await fetch(`/api/jobs/${result.id}`, { signal });
    if (!jobResponse.ok)
      throw new Error("AI questions are unavailable. Continue your review.");
    const job = await jobResponse.json();
    if (job.status === "succeeded") {
      await syncLibrary(db, () => {});
      if (!job.output?.activityId)
        throw new Error(
          "This note could not support a clear AI question. Regular review continues.",
        );
      return;
    }
    if (["failed", "cancelled", "cancel_requested"].includes(job.status))
      throw new Error(
        "An AI question could not be prepared. Regular review continues.",
      );
    await new Promise<void>((resolve) => {
      const abort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 2000);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
}

export async function selectSourcePractice(
  db: Library,
  sessionId: string,
  reviewedNoteId: string,
) {
  const session = await db.sessions.get(sessionId);
  if (!session) return;
  const notes = await db.notes.toArray();
  const candidates = (await db.activities.toArray()).filter(
    (a) =>
      validSourceActivity(a, notes) &&
      sourceBudgetFits(session, a.expectedSeconds) &&
      (a.format !== "brief_explanation" || session.teachbacks < 1) &&
      !session.interventions?.some((i) => i.activityId === a.id),
  );
  // Use material already reviewed in this session. Do not leak an upcoming card answer.
  const reviewed = new Set(
    (await db.reviews.where("sessionId").equals(sessionId).toArray())
      .filter((r) => r.status !== "undone" && r.status !== "concurrent")
      .map((r) => r.noteId),
  );
  return candidates
    .filter((a) => a.sources.every((s) => reviewed.has(s.noteId)))
    .sort(
      (a: Activity, b: Activity) =>
        Number(b.sources.some((s) => s.noteId === reviewedNoteId)) -
        Number(a.sources.some((s) => s.noteId === reviewedNoteId)),
    )[0];
}
