import {
  ActivitySchema,
  stableJson,
  type Activity,
  type Note,
  type StudySession,
} from "@recall/domain";
import { parseCloze, stripHtml } from "@recall/card-renderer";
import { DECK_PRACTICE_VERSION, validDeckActivity } from "./deck-practice";

export const SOURCE_PRACTICE_VERSION = "source-exercise-1";
export type SourceVariant = "recall" | "recognition" | "compare" | "restate";
export interface SourceUnit {
  field: number;
  answerField?: number;
  quote: string;
  prompt: string;
  answer: string;
  alternatives: string[];
}
/** Uses explicit clozes wherever they occur, or the first usable front/back text pair. */
export function sourceUnits(note: Note): SourceUnit[] {
  const excluded =
    /\b(patient|vignette|diagnos\w*|treat\w*|dose|dosage|dosing|prescrib\w*|contraindicat\w*|triage|prognosis|management|next step|system prompt|ignore (?:all|previous)|instructions)\b|\bmg\s*\/\s*kg\b|https?:\/\/|\b\d+[- ]year[- ]old\b/i;
  const fieldText = note.fields.map((raw) => {
    if (/<(?:img|svg|audio|video|iframe|script)\b|\[sound:/i.test(raw))
      return "";
    const text = stripHtml(raw).trim();
    if (
      !text ||
      text.length > 1200 ||
      /^\s*(?:[a-f\d]{24,}|\d{8,})\s*$/i.test(text) ||
      /\{\{(?!c\d+::)/i.test(text) ||
      excluded.test(text)
    )
      return "";
    return text;
  });

  // Cloze cards often keep their `Text` field after metadata, media, or an
  // empty field. Every supported target remains tied to its exact field.
  const clozeUnits: SourceUnit[] = [];
  fieldText.forEach((text, field) => {
    if (!text || !text.includes("{{")) return;
    let parts: ReturnType<typeof parseCloze>;
    try {
      parts = parseCloze(text);
    } catch {
      return;
    }
    const targets = parts.filter((part) => part.kind === "cloze");
    if (!targets.length || parts.some((part) => part.text.includes("{{")))
      return;
    const quote = parts.map((part) => part.text).join("");
    for (const target of targets.slice(0, 8)) {
      if (!target.text.trim() || target.text.length > 160) continue;
      clozeUnits.push({
        field,
        quote: text,
        prompt: parts
          .map((part) => (part === target ? "_____" : part.text))
          .join(""),
        answer: target.text,
        alternatives: [
          ...new Set(
            targets
              .filter((part) => part.text !== target.text)
              .map((part) => part.text),
          ),
        ]
          .filter((value) => value.trim() && value.length <= 160)
          .slice(0, 3),
      });
    }
  });
  if (clozeUnits.length) return clozeUnits;

  // Fall back to the first pair of usable text fields. This accommodates
  // legacy/basic note layouts with leading metadata or blank fields without
  // sending images, tags, or unrelated notes to the model.
  const promptField = fieldText.findIndex(
    (text) => !!text && !text.includes("{{"),
  );
  if (promptField < 0) return [];
  for (
    let answerField = promptField + 1;
    answerField < fieldText.length;
    answerField++
  ) {
    const prompt = fieldText[promptField];
    const answer = fieldText[answerField];
    if (!answer || answer.includes("{{") || answer.length > 800) continue;
    return [
      {
        field: promptField,
        answerField,
        quote: prompt,
        prompt,
        answer,
        alternatives: [],
      },
    ];
  }
  return [];
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
            field: unit.answerField ?? 1,
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
  if (activity.sourceRecipe?.generated)
    return validDeckActivity(activity, notes);
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
  const adaptive = session.aiPolicy === DECK_PRACTICE_VERSION;
  return (
    session.aiQuestions === true &&
    !session.completed &&
    session.budgetMinutes >= 5 &&
    session.checks < Math.floor(session.reviews / (adaptive ? 4 : 10)) &&
    session.interventionMs + seconds * 1000 <=
      session.budgetMinutes * 60000 * (adaptive ? 0.2 : 0.15) &&
    session.activeMs + session.interventionMs + seconds * 1000 <=
      session.budgetMinutes * 60000
  );
}
