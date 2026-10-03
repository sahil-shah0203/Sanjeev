import {
  type Activity,
  type Attempt,
  type Note,
  type StudySession,
  type Grade,
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
  if (session.checks >= Math.floor(session.reviews / 10)) return false;
  if (
    session.interventionMs + activity.expectedSeconds * 1000 >
    session.budgetMinutes * 60000 * 0.15
  )
    return false;
  if (activity.format === "brief_explanation" && session.teachbacks >= 1)
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
    if (!a.options?.some((o) => a.correctOptionIds?.includes(o.id)))
      errors.push("The key must refer to an option.");
    for (const option of a.options ?? [])
      if (
        !a.correctOptionIds?.includes(option.id) &&
        !a.distractorRationales?.[option.id]
      )
        errors.push("Each distractor needs a rejection rationale.");
  }
  if (a.format === "short_answer" && !a.acceptedAnswers?.length)
    errors.push("Short answers need a curated acceptance set.");
  if (a.format === "brief_explanation" && !a.rubric?.length)
    errors.push("Explanations need a rubric.");
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
  return (["recall", "explain", "discriminate", "apply"] as const).map(
    (dimension) => ({
      dimension,
      observations: attempts.filter(
        (a) =>
          !a.assistance &&
          !a.contaminated &&
          a.grade !== "uncertain" &&
          !a.dispute &&
          activities.some(
            (x) => x.id === a.activityId && x.cognitiveTask === dimension,
          ),
      ).length,
    }),
  );
}
