import {
  id,
  now,
  type Activity,
  type Attempt,
  type Intervention,
} from "@recall/domain";
import {
  ADAPTIVE_POLICY,
  deterministicGrade,
  eligibleActivity,
  validateActivity,
} from "@recall/learning";
import { Library, enqueue } from "../lib/db/local";

export async function openIntervention(
  db: Library,
  sessionId: string,
  activity: Activity,
  reason: string,
  requested = false,
) {
  return db.transaction(
    "rw",
    [db.sessions, db.activities, db.notes, db.exposures, db.outbox],
    async () => {
      const session = await db.sessions.get(sessionId);
      const current = await db.activities.get(activity.id);
      const notes = await db.notes.toArray();
      if (
        !session ||
        session.completed ||
        !current ||
        current.version !== activity.version ||
        current.status !== "human_approved" ||
        !current.reviewerId ||
        !current.approvedHash ||
        validateActivity(current, notes).length
      )
        throw new Error(
          "This check is no longer approved for the current source. Continue ordinary review.",
        );
      if (session.interventions?.some((i) => i.status === "open"))
        throw new Error("Another check is already open.");
      const exposures = await db.exposures
        .filter(
          (e) =>
            e.sessionId === sessionId ||
            Date.parse(e.at) > Date.now() - 30 * 60000,
        )
        .toArray();
      if (
        !requested &&
        !eligibleActivity(
          current,
          session,
          notes,
          new Set(exposures.map((e) => e.noteId)),
          0,
        )
      )
        throw new Error(
          "This check no longer fits the session budget or exposure rules.",
        );
      const entry: Intervention = {
        id: id(),
        activityId: current.id,
        activityVersion: current.version,
        reason,
        policy: ADAPTIVE_POLICY,
        startedAt: now(),
        durationMs: 0,
        expectedMs: current.expectedSeconds * 1000,
        requested,
        status: "open",
      };
      const updated = {
        ...session,
        interventions: [...(session.interventions ?? []), entry],
        checks: session.checks + (requested ? 0 : 1),
        teachbacks:
          session.teachbacks +
          (current.format === "brief_explanation" && !requested ? 1 : 0),
        updatedAt: now(),
      };
      await db.sessions.put(updated);
      await enqueue(db, "sessions", updated.id, updated);
      // Display itself is an exposure, including skips, crashes and abandoned tabs.
      for (const source of current.sources) {
        const exposure = {
          id: id(),
          cardId: "",
          noteId: source.noteId,
          sessionId,
          at: now(),
          kind: "adaptive" as const,
          activityId: current.id,
        };
        await db.exposures.put(exposure);
        await enqueue(db, "exposures", exposure.id, exposure);
      }
      return entry;
    },
  );
}

export async function checkpointIntervention(
  db: Library,
  sessionId: string,
  interventionId: string,
  durationMs: number,
  status: Intervention["status"] = "open",
) {
  await db.transaction("rw", db.sessions, db.outbox, async () => {
    const session = await db.sessions.get(sessionId);
    const entry = session?.interventions?.find((i) => i.id === interventionId);
    if (!session || !entry || entry.status !== "open") return;
    const elapsed = Math.max(
      entry.durationMs,
      Math.min(86400000, Math.max(0, durationMs)),
    );
    const updated = {
      ...session,
      interventionMs: session.interventionMs + elapsed - entry.durationMs,
      interventions: session.interventions!.map((i) =>
        i.id === entry.id ? { ...i, durationMs: elapsed, status } : i,
      ),
      updatedAt: now(),
    };
    await db.sessions.put(updated);
    await enqueue(db, "sessions", updated.id, updated);
  });
}

export async function recoverInterventions(db: Library, sessionId: string) {
  const session = await db.sessions.get(sessionId);
  for (const entry of session?.interventions ?? []) {
    if (entry.status === "open")
      await checkpointIntervention(
        db,
        sessionId,
        entry.id,
        Math.max(entry.durationMs, entry.expectedMs),
        "interrupted",
      );
  }
}

export async function saveAdaptiveAttempt(
  db: Library,
  sessionId: string,
  interventionId: string,
  answer: string,
  durationMs: number,
) {
  return db.transaction(
    "rw",
    [db.sessions, db.activities, db.attempts, db.outbox],
    async () => {
      const prior = await db.attempts.get(interventionId);
      if (prior) return prior;
      const session = await db.sessions.get(sessionId);
      const entry = session?.interventions?.find(
        (i) => i.id === interventionId,
      );
      const activity = entry && (await db.activities.get(entry.activityId));
      if (
        !entry ||
        entry.status !== "open" ||
        !activity ||
        activity.status !== "human_approved" ||
        activity.version !== entry.activityVersion
      )
        throw new Error(
          "This check changed. Your original schedule is safe; continue review.",
        );
      const attempt: Attempt = {
        id: entry.id,
        activityId: activity.id,
        activityVersion: activity.version,
        sessionId,
        answer: answer.slice(0, 16000),
        at: now(),
        durationMs,
        assistance: entry.requested,
        contaminated: entry.requested,
        ...deterministicGrade(activity, answer),
        format: activity.format,
        cognitiveTask: activity.cognitiveTask,
        objective: activity.objective,
        selectionReason: entry.reason,
        policy: entry.policy,
      };
      await db.attempts.add(attempt);
      await enqueue(db, "attempts", attempt.id, attempt);
      await checkpointIntervention(db, sessionId, interventionId, durationMs);
      return attempt;
    },
  );
}
