import {
  ActivitySchema,
  stableJson,
  type Activity,
  type Note,
  type StudySession,
} from "@recall/domain";
import { parseCloze, stripHtml } from "@recall/card-renderer";

export const SOURCE_PRACTICE_VERSION = "source-exercise-1";
export type SourceVariant = "recall" | "recognition" | "compare" | "restate";
export interface SourceUnit {
  field: number;
  quote: string;
  prompt: string;
  answer: string;
  alternatives: string[];
}
/** Only primary text (and the answer field on a basic note). No extras, tags or media. */
export function sourceUnits(note: Note): SourceUnit[] {
  const text = stripHtml(note.fields[0] ?? "").trim();
  if (!text || text.length > 1200 || /\[sound:|\{\{(?!c\d+::)/i.test(text))
    return [];
  const excluded =
    /\b(patient|vignette|diagnos\w*|treat\w*|dose|dosage|dosing|prescrib\w*|contraindicat\w*|triage|prognosis|management|next step|system prompt|ignore (?:all|previous)|instructions)\b|\bmg\s*\/\s*kg\b|https?:\/\/|\b\d+[- ]year[- ]old\b/i;
  if (excluded.test(text)) return [];
  let parts: ReturnType<typeof parseCloze>;
  try {
    parts = parseCloze(text);
  } catch {
    return [];
  }
  const targets = parts.filter((p) => p.kind === "cloze");
  if (
    text.includes("{{") &&
    (!targets.length || parts.some((p) => p.text.includes("{{")))
  )
    return [];
  if (targets.length) {
    const quote = parts.map((p) => p.text).join("");
    return targets
      .slice(0, 8)
      .flatMap((target) => {
        if (!target.text.trim() || target.text.length > 160) return [];
        return [
          {
            field: 0,
            quote: text,
            prompt: parts
              .map((p) => (p === target ? "_____" : p.text))
              .join(""),
            answer: target.text,
            alternatives: [
              ...new Set(
                targets
                  .filter((p) => p.text !== target.text)
                  .map((p) => p.text),
              ),
            ]
              .filter((x) => x.trim() && x.length <= 160)
              .slice(0, 3),
          },
        ];
      })
      .filter((u) => quote.length > u.answer.length);
  }
  const answer = stripHtml(note.fields[1] ?? "").trim();
  if (
    !answer ||
    answer.length > 800 ||
    /\{\{|\[sound:/i.test(answer) ||
    excluded.test(answer)
  )
    return [];
  return [{ field: 0, quote: text, prompt: text, answer, alternatives: [] }];
}
export function sourceVariants(note: Note): SourceVariant[] {
  const units = sourceUnits(note);
  if (!units.length) return [];
  return [
    "recall",
    ...(units.some((u) => u.alternatives.length)
      ? ["recognition" as const, "compare" as const]
      : []),
    "restate",
  ];
}
/** No model-authored text is displayed. All content is compiled from this recipe. */
export function compileSourceActivity(
  note: Note,
  recipe: NonNullable<Activity["sourceRecipe"]>,
  identity: Pick<Activity, "id" | "version" | "modelVersion">,
): Activity {
  const units = sourceUnits(note);
  const unit = units[recipe.unit];
  if (!unit || !sourceVariants(note).includes(recipe.variant))
    throw new Error("UNSUPPORTED_SOURCE_EXERCISE");
  const filled = parseCloze(unit.quote)
    .map((p) => p.text)
    .join("");
  const isCloze = unit.quote.includes("{{c");
  const rationale = isCloze ? filled : `${unit.quote}\n${unit.answer}`;
  const sources = [
    {
      noteId: note.id,
      version: note.version,
      field: unit.field,
      quote: unit.quote,
    },
    ...(!isCloze
      ? [
          {
            noteId: note.id,
            version: note.version,
            field: 1,
            quote: unit.answer,
          },
        ]
      : []),
  ];
  const base = {
    id: identity.id,
    version: identity.version,
    modelVersion: identity.modelVersion,
    sourceRecipe: recipe,
    objective: `Source wording: ${unit.answer}`.slice(0, 1000),
    sources,
    rationale,
    status: "source_bounded" as const,
    promptVersion: SOURCE_PRACTICE_VERSION,
    validatorVersion: SOURCE_PRACTICE_VERSION,
  };
  if (recipe.variant === "recognition") {
    if (!unit.alternatives.length)
      throw new Error("UNSUPPORTED_SOURCE_EXERCISE");
    // Alternatives are quoted terms, never invented false clinical statements.
    const texts = [unit.answer, ...unit.alternatives].sort((a, b) =>
      a.localeCompare(b),
    );
    const options = texts.map((text, i) => ({ id: String(i), text }));
    return ActivitySchema.parse({
      ...base,
      format: "multiple_choice",
      cognitiveTask: "recall",
      expectedSeconds: 20,
      stem: `Which exact wording fills the gap in your original note?\n\n${unit.prompt}`,
      options,
      correctOptionIds: [String(texts.indexOf(unit.answer))],
      distractorRationales: Object.fromEntries(
        options
          .filter((o) => o.text !== unit.answer)
          .map((o) => [
            o.id,
            `That term occurs elsewhere in this note. The wording at this gap is: ${unit.answer}. Check the original source below.`,
          ]),
      ),
    });
  }
  if (recipe.variant === "compare" || recipe.variant === "restate") {
    if (recipe.variant === "compare" && !unit.alternatives.length)
      throw new Error("UNSUPPORTED_SOURCE_EXERCISE");
    return ActivitySchema.parse({
      ...base,
      format: "brief_explanation",
      cognitiveTask: recipe.variant === "compare" ? "discriminate" : "explain",
      expectedSeconds: 30,
      stem:
        recipe.variant === "compare"
          ? `Compare how this note uses “${unit.answer}” and “${unit.alternatives[0]}”. Describe only the distinction explicitly stated; if none is stated, say so.\n\n${filled}`
          : `Restate this source in one sentence, preserving its qualifiers. Do not add an explanation that is not in the note.\n\n${rationale}`,
      rubric: [
        {
          id: "source",
          criterion:
            "Self-check against the quoted source. Preserve its qualifications and do not add facts.",
          essential: true,
        },
      ],
    });
  }
  return ActivitySchema.parse({
    ...base,
    format: "short_answer",
    cognitiveTask: "recall",
    expectedSeconds: 20,
    stem: isCloze
      ? `Complete the wording from your note.\n\n${unit.prompt}`
      : unit.prompt,
    acceptedAnswers: [unit.answer],
  });
}
export function validSourceActivity(
  activity: Activity,
  notes: Note[],
): boolean {
  if (
    activity.status !== "source_bounded" ||
    !activity.sourceRecipe ||
    activity.reviewerId ||
    activity.approvedHash
  )
    return false;
  const note = notes.find(
    (n) =>
      n.id === activity.sources[0]?.noteId &&
      n.version === activity.sources[0]?.version,
  );
  if (!note) return false;
  try {
    return (
      stableJson(
        compileSourceActivity(note, activity.sourceRecipe, activity),
      ) === stableJson(ActivitySchema.parse(activity))
    );
  } catch {
    return false;
  }
}
export function sourceBudgetFits(session: StudySession, seconds: number) {
  return (
    session.aiQuestions === true &&
    !session.completed &&
    session.budgetMinutes >= 5 &&
    session.checks < Math.floor(session.reviews / 10) &&
    session.interventionMs + seconds * 1000 <=
      session.budgetMinutes * 60000 * 0.15 &&
    session.activeMs + session.interventionMs + seconds * 1000 <=
      session.budgetMinutes * 60000
  );
}
