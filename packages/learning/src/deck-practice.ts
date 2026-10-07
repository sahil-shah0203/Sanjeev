import type {
  Activity,
  Note,
  NoteType,
  SourceCard,
  SourceRef,
  RecallRating,
  Attempt,
} from "@recall/domain";
import { stripHtml, parseCloze } from "@recall/card-renderer";
export const DECK_PRACTICE_VERSION = "deck-adaptive-2";
export type DeckVariant =
  "recall" | "recognition" | "compare" | "restate" | "apply" | "repair";
export interface DeckSource {
  sources: SourceRef[];
  prompt: string;
  answer: string;
  explanationOnly: boolean;
}
const normalize = (value: string) =>
  value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
export function deckSource(
  note: Note,
  type?: NoteType,
  card?: SourceCard,
): DeckSource | undefined {
  const fields = note.fields
    .map((raw, field) => ({ field, text: stripHtml(raw).trim() }))
    .filter(
      ({ field, text }) =>
        text &&
        text.length <= 4000 &&
        !/^(?:[a-f\d]{24,}|\d{8,})$/i.test(text) &&
        !/^(?:id|guid|tags|sources|audio|image|.*mask)(?:\b|$)/i.test(
          type?.fields[field] ?? "",
        ) &&
        !/ignore (?:all|previous) instructions|system prompt|\b\d+[- ]year[- ]old\b/i.test(
          text,
        ),
    );
  if (!fields.length) return;
  const references = (primary: number[]) => {
    let remaining = 6500;
    return [
      ...fields.filter((item) => primary.includes(item.field)),
      ...fields.filter((item) => !primary.includes(item.field)),
    ]
      .filter(({ text }) => {
        if (text.length > remaining) return false;
        remaining -= text.length;
        return true;
      })
      .slice(0, 4)
      .map(({ field, text }) => ({
        noteId: note.id,
        version: note.version,
        field,
        quote: text,
      }));
  };
  for (const { text, field } of fields) {
    if (!text.includes("{{c")) continue;
    try {
      const parts = parseCloze(text);
      const target = parts.find(
        (part) =>
          part.kind === "cloze" && (!card || part.index === card.ord + 1),
      );
      if (
        !target?.text.trim() ||
        target.text.length > 1200 ||
        parts.some((part) => part.text.includes("{{"))
      )
        continue;
      return {
        sources: references([field]),
        prompt: parts
          .map((part) => (part === target ? "_____" : part.text))
          .join(""),
        answer: target.text,
        explanationOnly: false,
      };
    } catch {
      continue;
    }
  }
  const template = type?.templates.find(
    (item) => item.ord === (type.kind === "cloze" ? 0 : (card?.ord ?? 0)),
  );
  const used = (html: string) =>
    [...html.matchAll(/\{\{([^{}]+)\}\}/g)]
      .map((match) =>
        match[1]
          .replace(/^[#^/]/, "")
          .split(":")
          .at(-1),
      )
      .map((name) => type?.fields.indexOf(name ?? "") ?? -1);
  const front = template ? used(template.front) : [fields[0].field];
  const back = template
    ? used(template.back).filter((field) => !front.includes(field))
    : [fields[1]?.field];
  const prompt = fields.find((value) => front.includes(value.field));
  const answer = fields.find((value) => back.includes(value.field));
  if (prompt && answer && answer.text.length <= 1200)
    return {
      sources: references([prompt.field, answer.field]),
      prompt: prompt.text,
      answer: answer.text,
      explanationOnly: false,
    };
  // Image-only labels cannot support mechanisms. Visible accompanying text can
  // support an explanation of exactly what it states, without image inference.
  const fact = fields.find(
    (value) =>
      value.text.length >= 20 &&
      value.text.length <= 1200 &&
      !value.text.includes("{{"),
  );
  if (fact)
    return {
      sources: references([fact.field]),
      prompt: fact.text,
      answer: fact.text,
      explanationOnly: true,
    };
}
export function validDeckActivity(activity: Activity, notes: Note[]): boolean {
  if (
    activity.status !== "source_bounded" ||
    !activity.sourceRecipe?.generated ||
    activity.promptVersion !== DECK_PRACTICE_VERSION ||
    !activity.sourceContext
  )
    return false;
  if (
    !activity.sources.every((ref) =>
      notes.some(
        (note) =>
          note.id === ref.noteId &&
          note.version === ref.version &&
          stripHtml(note.fields[ref.field] ?? "").includes(ref.quote),
      ),
    )
  )
    return false;
  const target = normalize(activity.sourceContext.targetAnswer);
  if (!activity.sources.some((ref) => normalize(ref.quote).includes(target)))
    return false;
  if (activity.format === "multiple_choice") {
    const keys = activity.correctOptionIds;
    if (
      keys?.length !== 1 ||
      !activity.options?.some(
        (option) => option.id === keys[0] && normalize(option.text) === target,
      )
    )
      return false;
    if (
      new Set(activity.options.map((option) => normalize(option.text))).size !==
      activity.options.length
    )
      return false;
    if (
      !activity.options.every(
        (option) =>
          keys.includes(option.id) ||
          activity.distractorRationales?.[option.id],
      )
    )
      return false;
  }
  if (
    activity.format === "short_answer" &&
    !activity.acceptedAnswers?.some((answer) => normalize(answer) === target)
  )
    return false;
  if (
    activity.format === "brief_explanation" &&
    !activity.rubric?.some((item) => item.essential)
  )
    return false;
  return true;
}
export function chooseDeckVariant(
  rating: RecallRating,
  attempts: Attempt[],
  activities: Activity[],
  source: DeckSource,
  rotation = 0,
): DeckVariant {
  if (source.explanationOnly || rating === "again" || rating === "hard")
    return "repair";
  const available: DeckVariant[] =
    rating === "easy"
      ? ["apply", "compare", "recall", "recognition", "restate"]
      : ["recall", "recognition", "restate", "compare"];
  const count = (variant: DeckVariant) =>
    attempts
      .filter(
        (attempt) =>
          !attempt.dispute &&
          activities.some(
            (activity) =>
              activity.id === attempt.activityId &&
              (activity.sourceContext?.style ??
                activity.sourceRecipe?.variant) === variant,
          ),
      )
      .reduce((score, attempt) => {
        const outcome = attempt.modelGrade?.outcome ?? attempt.grade;
        return (
          score +
          (outcome === "correct"
            ? 0.25
            : outcome === "incorrect" || outcome === "partially_correct"
              ? -0.25
              : 0.1)
        );
      }, 0);
  const offset = Math.abs(rotation) % available.length;
  const rotated = [...available.slice(offset), ...available.slice(0, offset)];
  return rotated.sort((a, b) => count(a) - count(b))[0];
}
