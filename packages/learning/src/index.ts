import {
  type Activity,
  type Attempt,
  type Note,
  type StudySession,
  type Grade,
  type ReviewEvent,
} from "@recall/domain";
import { stripHtml } from "@recall/card-renderer";
export function eligibleActivity(
  activity: Activity,
  session: StudySession,
  notes: Note[],
  exposedNoteIds: Set<string>,
  overdue: number,
): boolean {
  if (
    activity.status !== "human_approved" ||
    !activity.reviewerId ||
    !activity.approvedHash
  )
    return false;
  if (session.budgetMinutes <= 0 || session.budgetMinutes < 5 || overdue > 100)
    return false;
  if (
    session.completed ||
    session.activeMs +
      session.interventionMs +
      activity.expectedSeconds * 1000 >
      session.budgetMinutes * 60000
  )
    return false;
  if (session.checks >= Math.floor(session.reviews / 10)) return false;
  if (
    session.interventionMs + activity.expectedSeconds * 1000 >
    session.budgetMinutes * 60000 * 0.15
  )
    return false;
  if (activity.format === "brief_explanation" && session.teachbacks >= 1)
    return false;
  if (session.interventions?.some((i) => i.activityId === activity.id))
    return false;
  return activity.sources.every(
    (ref) =>
      !exposedNoteIds.has(ref.noteId) &&
      notes.some((n) => n.id === ref.noteId && n.version === ref.version),
  );
}
export function validateActivity(a: Activity, notes: Note[]): string[] {
  const errors: string[] = [];
  if (!a.rationale.trim())
    errors.push("A source-supported rationale is required.");
  for (const s of a.sources) {
    const n = notes.find((n) => n.id === s.noteId && n.version === s.version);
    if (
      !n ||
      !(
        n.fields[s.field]?.includes(s.quote) ||
        stripHtml(n.fields[s.field] ?? "").includes(s.quote)
      )
    )
      errors.push("Source quote or version does not exist.");
  }
  if (a.format === "multiple_choice") {
    if (!a.options || a.options.length < 2 || a.correctOptionIds?.length !== 1)
      errors.push(
        "Multiple choice requires exactly one key and at least two options.",
      );
    if (new Set(a.options?.map((o) => o.id)).size !== a.options?.length)
      errors.push("Option identifiers must be unique.");
    if (
      new Set(a.options?.map((o) => o.text.trim().toLowerCase())).size !==
      a.options?.length
    )
      errors.push("Option wording must be distinct.");
    if (!a.options?.some((o) => a.correctOptionIds?.includes(o.id)))
      errors.push("The key must refer to an option.");
    for (const option of a.options ?? [])
      if (
        !a.correctOptionIds?.includes(option.id) &&
        !a.distractorRationales?.[option.id]
      )
        errors.push("Each distractor needs a rejection rationale.");
  }
  if (a.format === "short_answer" && !a.acceptedAnswers?.some((s) => s.trim()))
    errors.push("Short answers need a curated acceptance set.");
  if (a.format === "brief_explanation" && !a.rubric?.length)
    errors.push("Explanations need a rubric.");
  if (
    a.cognitiveTask !== "recall" &&
    !a.rubric?.some((r) => r.essential && r.criterion.trim())
  )
    errors.push(
      "Deeper tasks need an explicit essential relationship or decision criterion.",
    );
  if (a.format !== "multiple_choice" && a.options?.length)
    errors.push("Only multiple-choice activities can contain options.");
  return errors;
}
export function deterministicGrade(
  a: Activity,
  answer: string,
): { grade: Grade; feedback: string } {
  const normalize = (s: string) =>
    s.normalize("NFC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
  if (a.format === "multiple_choice")
    return {
      grade: a.correctOptionIds?.includes(answer) ? "correct" : "incorrect",
      feedback: a.distractorRationales?.[answer] ?? a.rationale,
    };
  if (a.acceptedAnswers?.some((x) => normalize(x) === normalize(answer)))
    return { grade: "correct", feedback: a.rationale };
  return {
    grade: "uncertain",
    feedback:
      "This answer needs a self-check. Compare it with the source and rubric; wording alone cannot establish correctness.",
  };
}
export function evidence(attempts: Attempt[], activities: Activity[]) {
  return (
    ["recall", "recognition", "explain", "discriminate", "apply"] as const
  ).map((dimension) => ({
    dimension,
    observations: attempts.filter(
      (a) =>
        !a.assistance &&
        !a.contaminated &&
        a.grade !== "uncertain" &&
        !a.dispute &&
        (() => {
          const activity = activities.find(
            (x) => x.id === a.activityId && x.version === a.activityVersion,
          );
          const task = a.cognitiveTask ?? activity?.cognitiveTask;
          const format = a.format ?? activity?.format;
          return (
            (task === "recall" && format === "multiple_choice"
              ? "recognition"
              : task) === dimension
          );
        })(),
    ).length,
  }));
}

export const ADAPTIVE_POLICY = "recall-adaptive-2";
export interface SelectionContext {
  session: StudySession;
  notes: Note[];
  activities: Activity[];
  reviews: ReviewEvent[];
  attempts: Attempt[];
  exposedNoteIds: Set<string>;
  overdue: number;
  learningDue: boolean;
  at: string;
  requestedNoteId?: string;
}
export function objectiveKey(a: Activity) {
  return `${a.sources
    .map((s) => `${s.noteId}:${s.version}`)
    .sort()
    .join("|")}:${a.objective.trim().toLowerCase()}`;
}
function seededScore(value: string) {
  let n = 2166136261;
  for (const ch of value) n = Math.imul(n ^ ch.charCodeAt(0), 16777619);
  return n >>> 0;
}
/** Transparent hypotheses from research §7. No inferred diagnosis or schedule credit. */
export function selectActivity(
  ctx: SelectionContext,
): { activity: Activity; reason: string; policy: string } | undefined {
  if (ctx.session.completed || (ctx.learningDue && !ctx.requestedNoteId))
    return;
  const since = Date.parse(ctx.at) - 14 * 86400000;
  const recent = ctx.reviews.filter(
    (r) =>
      r.status !== "undone" &&
      r.status !== "concurrent" &&
      Date.parse(r.at) >= since &&
      r.at <= ctx.at,
  );
  const selected = ctx.activities.flatMap((a) => {
    const ids = new Set(a.sources.map((s) => s.noteId));
    if (ctx.requestedNoteId) {
      if (
        !ids.has(ctx.requestedNoteId) ||
        a.status !== "human_approved" ||
        !a.reviewerId ||
        !a.approvedHash ||
        validateActivity(a, ctx.notes).length
      )
        return [];
    } else if (
      !eligibleActivity(
        a,
        ctx.session,
        ctx.notes,
        ctx.exposedNoteIds,
        ctx.overdue,
      ) ||
      validateActivity(a, ctx.notes).length
    )
      return [];
    const history = ctx.attempts
      .filter((t) => {
        const previous = ctx.activities.find(
          (v) => v.id === t.activityId && v.version === t.activityVersion,
        );
        return previous && objectiveKey(previous) === objectiveKey(a);
      })
      .sort((x, y) => y.at.localeCompare(x.at));
    const valid = history.filter(
      (t) =>
        !t.assistance &&
        !t.contaminated &&
        !t.dispute &&
        t.grade !== "uncertain" &&
        Date.parse(t.at) >= since,
    );
    const failures = new Set(
      recent
        .filter((r) => ids.has(r.noteId) && r.rating === "again")
        .map((r) => r.studyDay),
    );
    const successful = recent.filter(
      (r) => ids.has(r.noteId) && r.rating !== "again",
    );
    const gap = valid.some(
      (t) =>
        t.grade === "incorrect" &&
        ctx.activities.find((v) => v.id === t.activityId)?.cognitiveTask ===
          "apply" &&
        successful.some((r) => r.at < t.at),
    );
    const confusion = new Map<string, number>();
    for (const t of valid.filter((t) => t.grade === "incorrect")) {
      const previous = ctx.activities.find((v) => v.id === t.activityId)!;
      if (previous.format !== "multiple_choice") continue;
      const wrong = previous.options?.find((o) => o.id === t.answer)?.text;
      const correct = previous.options?.find((o) =>
        previous.correctOptionIds?.includes(o.id),
      )?.text;
      if (wrong && correct) {
        const key = `${wrong}|${correct}`;
        confusion.set(key, (confusion.get(key) ?? 0) + 1);
      }
    }
    let priority = 0,
      reason = "";
    if (ctx.requestedNoteId) {
      priority = 5;
      reason = "You requested a source-supported understanding check.";
    } else if (failures.size >= 2) {
      priority = 4;
      reason =
        "Two recall failures on distinct study days within 14 days; a brief repair may help.";
    } else if (gap && ["apply", "explain"].includes(a.cognitiveTask)) {
      priority = 3;
      reason =
        "Successful recall followed by an incorrect application probe; check the relationship.";
    } else if (
      [...confusion.values()].some((n) => n >= 2) &&
      a.cognitiveTask === "discriminate"
    ) {
      priority = 2;
      reason =
        "The same alternatives were confused twice; compare their distinguishing feature.";
    } else if (
      successful.length &&
      seededScore(`${ctx.session.seed}:${objectiveKey(a)}`) % 5 === 0
    ) {
      priority = 1;
      reason =
        "A seeded diagnostic sample of a previously successful objective.";
    }
    if (!priority) return [];
    const previous = ctx.activities.find(
      (v) => v.id === history[0]?.activityId,
    );
    return [
      {
        activity: a,
        reason,
        policy: ADAPTIVE_POLICY,
        priority,
        rotate: previous && previous.format !== a.format ? 1 : 0,
        rank: seededScore(`${ctx.session.seed}:${a.id}`),
      },
    ];
  });
  return selected.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.rotate - a.rotate ||
      a.rank - b.rank ||
      a.activity.id.localeCompare(b.activity.id),
  )[0];
}
