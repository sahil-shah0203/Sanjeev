import {
  type CardState,
  type ImportBundle,
  type Preferences,
  type Raw,
  type RecallRating,
} from "@recall/domain";
import { configFor, freshState, studyDay, transition } from "./index";

export interface MigrationPlan {
  supported: boolean;
  reasons: string[];
  states: CardState[];
  replayedReviews: number;
  preservedDates: number;
  preview: {
    cardId: string;
    sourceDay: string;
    replayedDue: string;
    due: string;
  }[];
}

// Anki review-card due values are collection-relative calendar days, not Unix
// timestamps. The user confirms the export timezone; use calendar arithmetic so
// a DST boundary cannot move the card to another study day.
export function reviewDue(
  crt: unknown,
  day: unknown,
  timezone: string,
  rollover: number,
): { day: string; at: string } {
  const creation = Number(crt),
    offset = Number(day);
  if (
    !Number.isSafeInteger(creation) ||
    creation < 946684800 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100000
  )
    throw new Error(
      "Collection creation time or due day is outside the supported range.",
    );
  const base = studyDay(new Date(creation * 1000).toISOString(), timezone, 0);
  const calendar = new Date(`${base}T12:00:00.000Z`);
  calendar.setUTCDate(calendar.getUTCDate() + offset);
  const target = calendar.toISOString().slice(0, 10);
  let lo = calendar.getTime() - 48 * 3600000,
    hi = calendar.getTime() + 48 * 3600000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (studyDay(new Date(mid).toISOString(), timezone, rollover) < target)
      lo = mid;
    else hi = mid;
  }
  return { day: target, at: new Date(hi).toISOString() };
}

/** Conservative complete-history adapter. No ease-factor-to-memory conversion. */
export function planHistory(
  bundle: ImportBundle,
  prefs: Preferences,
  at = new Date().toISOString(),
): MigrationPlan {
  const plan: MigrationPlan = {
    supported: true,
    reasons: [],
    states: [],
    replayedReviews: 0,
    preservedDates: 0,
    preview: [],
  };
  const logs = new Map<string, Raw[]>();
  for (const row of bundle.report.history) {
    const cid = String(row.cid);
    const list = logs.get(cid) ?? [];
    list.push(row);
    logs.set(cid, list);
  }
  for (const card of bundle.cards) {
    try {
      const raw = card.raw,
        history = (logs.get(card.originalId) ?? []).sort(
          (a, b) => Number(a.id) - Number(b.id),
        );
      if (Number(raw.odid ?? 0) !== 0)
        throw new Error(
          "filtered-deck state must be returned to its home deck before export",
        );
      if (
        Number(raw.type ?? 0) === 0 &&
        Number(raw.reps ?? 0) === 0 &&
        !history.length
      ) {
        plan.states.push(freshState(card.id, at, configFor(prefs.retention)));
        continue;
      }
      if (Number(raw.type) !== 2)
        throw new Error(
          "in-progress learning or relearning is outside this history adapter",
        );
      if (
        !history.length ||
        history.length !== Number(raw.reps) ||
        Number(history[0].type) !== 0
      )
        throw new Error(
          "review logs are incomplete or do not begin with initial learning",
        );
      const seen = new Set<string>();
      let state = freshState(
        card.id,
        new Date(Number(history[0].id)).toISOString(),
        configFor(prefs.retention),
      );
      for (const row of history) {
        const millis = Number(row.id),
          ease = Number(row.ease),
          kind = Number(row.type);
        if (
          !Number.isSafeInteger(millis) ||
          millis < 946684800000 ||
          millis > Date.parse(at) + 300000 ||
          seen.has(String(row.id))
        )
          throw new Error("review timestamps are invalid or duplicated");
        if (![0, 1, 2].includes(kind) || ![1, 2, 3, 4].includes(ease))
          throw new Error(
            "manual rescheduling, filtered reviews, and unrated events require a separate adapter",
          );
        seen.add(String(row.id));
        state = transition(
          state,
          (["again", "hard", "good", "easy"] as RecallRating[])[ease - 1],
          new Date(millis).toISOString(),
          `import:${row.id}`,
          {
            original: true,
            attempted: true,
            assisted: false,
            contaminated: false,
          },
        );
      }
      if (state.memory.state !== 2)
        throw new Error("this history ends in an incompatible learning step");
      const due = reviewDue(
        bundle.report.rawCollection.crt,
        raw.due,
        prefs.timezone,
        prefs.rollover,
      );
      if (due.at < state.memory.last_review!)
        throw new Error("the stored next due date precedes the final review");
      plan.preview.push({
        cardId: card.originalId,
        sourceDay: due.day,
        replayedDue: state.memory.due,
        due: due.at,
      });
      plan.states.push({
        ...state,
        memory: { ...state.memory, due: due.at },
        version: 0,
        head: null,
        origin: "replay",
      });
      plan.replayedReviews += history.length;
      plan.preservedDates++;
    } catch (error) {
      plan.supported = false;
      plan.reasons.push(
        `Card ${card.originalId}: ${error instanceof Error ? error.message : "unsupported history"}.`,
      );
    }
  }
  return plan;
}
