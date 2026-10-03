import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
  type FSRSParameters,
  type Grade,
} from "ts-fsrs";
import {
  type CardState,
  type MemoryState,
  type RecallRating,
  type SchedulerConfig,
} from "@recall/domain";
export { planHistory, reviewDue, type MigrationPlan } from "./migration";

export const LIBRARY_VERSION = "ts-fsrs@5.4.2";
export const configFor = (retention = 0.9): SchedulerConfig => ({
  version: `fsrs-1-r${retention}`,
  library: LIBRARY_VERSION,
  retention,
  fuzz: false,
  learningSteps: ["1m", "10m"],
  relearningSteps: ["10m"],
});
const serialize = (card: Card): MemoryState => ({
  ...card,
  due: card.due.toISOString(),
  last_review: card.last_review?.toISOString(),
});
const hydrate = (card: MemoryState): Card => ({
  ...card,
  due: new Date(card.due),
  last_review: card.last_review ? new Date(card.last_review) : undefined,
});
const mapping = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;
export function freshState(
  cardId: string,
  at: string,
  config = configFor(),
): CardState {
  return {
    id: cardId,
    memory: serialize(createEmptyCard(new Date(at))),
    version: 0,
    head: null,
    origin: "fresh",
    config,
  };
}
export interface Qualification {
  original: boolean;
  attempted: boolean;
  assisted: boolean;
  contaminated: boolean;
  confirmedFailure?: boolean;
}
export function qualifies(q: Qualification, rating: RecallRating): boolean {
  return (
    q.original &&
    q.attempted &&
    ((rating === "again" && !!q.confirmedFailure) ||
      (!q.assisted && !q.contaminated))
  );
}
export function transition(
  state: CardState,
  rating: RecallRating,
  at: string,
  eventId: string,
  q: Qualification,
  config = state.config,
): CardState {
  if (!qualifies(q, rating))
    throw new Error(
      "This practice is an exposure only and cannot change the original schedule.",
    );
  if (state.memory.last_review && at < state.memory.last_review)
    throw new Error(
      "Review time is before the previous review. Check your device clock.",
    );
  const params = generatorParameters({
    request_retention: config.retention,
    enable_fuzz: false,
    enable_short_term: true,
    learning_steps: config.learningSteps as FSRSParameters["learning_steps"],
    relearning_steps:
      config.relearningSteps as FSRSParameters["relearning_steps"],
  });
  const card = fsrs(params).next(
    hydrate(state.memory),
    new Date(at),
    mapping[rating] as Grade,
  ).card;
  return {
    ...state,
    memory: serialize(card),
    version: state.version + 1,
    head: eventId,
    origin: "review",
    config,
  };
}
export function preview(state: CardState, at: string) {
  return Object.fromEntries(
    (Object.keys(mapping) as RecallRating[]).map((r) => [
      r,
      transition(state, r, at, "preview", {
        original: true,
        attempted: true,
        assisted: false,
        contaminated: false,
      }).memory.due,
    ]),
  ) as Record<RecallRating, string>;
}
export function studyDay(at: string, timezone: string, rollover = 4): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (n: string) => Number(parts.find((p) => p.type === n)?.value);
  const date = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  if (get("hour") < rollover) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
export function nextRollover(
  at: string,
  timezone: string,
  rollover = 4,
): string {
  const day = studyDay(at, timezone, rollover);
  let lo = Date.parse(at),
    hi = lo + 27 * 3600000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (studyDay(new Date(mid).toISOString(), timezone, rollover) === day)
      lo = mid;
    else hi = mid;
  }
  return new Date(hi).toISOString();
}
export function intervalLabel(due: string, at: string): string {
  const mins = Math.max(
    1,
    Math.round((Date.parse(due) - Date.parse(at)) / 60000),
  );
  return mins < 60
    ? `${mins}m`
    : mins < 1440
      ? `${Math.round(mins / 60)}h`
      : `${Math.round(mins / 1440)}d`;
}
