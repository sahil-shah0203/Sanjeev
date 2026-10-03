import {
  stableJson,
  type CardState,
  type ReviewEvent,
  type UndoEvent,
  type Mutation,
} from "@recall/domain";
const entityOrder = [
  "types",
  "decks",
  "notes",
  "cards",
  "states",
  "imports",
  "preferences",
  "activities",
  "attempts",
  "exposures",
  "sessions",
  "reviews",
  "undos",
];
export function mutationOrder(a: Mutation, b: Mutation) {
  return (
    a.at.localeCompare(b.at) ||
    entityOrder.indexOf(a.entity) - entityOrder.indexOf(b.entity) ||
    (a.kind === "review" && b.kind === "review"
      ? Number((a.value as ReviewEvent).sequence) -
        Number((b.value as ReviewEvent).sequence)
      : 0) ||
    a.id.localeCompare(b.id)
  );
}
import { transition } from "@recall/scheduler";
export function reconcileReview(
  current: CardState,
  event: ReviewEvent,
  serverNow: string,
): { state: CardState; event: ReviewEvent; conflict?: string } {
  if (event.cardId !== current.id || event.before.id !== current.id)
    throw new Error("Review card identity does not match.");
  if (
    !Number.isFinite(Date.parse(event.at)) ||
    Date.parse(event.at) > Date.parse(serverNow) + 300000
  )
    return {
      state: current,
      event: { ...event, status: "concurrent" },
      conflict: "Device clock is ahead. Review was retained as exposure.",
    };
  if (event.parent !== current.head || event.baseVersion !== current.version)
    return {
      state: current,
      event: { ...event, status: "concurrent" },
      conflict:
        "Another review extended this card first. Both events are preserved.",
    };
  if (stableJson(event.before.memory) !== stableJson(current.memory))
    throw new Error(
      "Review starting state does not match the canonical state.",
    );
  const after = transition(
    current,
    event.rating,
    event.at,
    event.id,
    { original: true, attempted: true, assisted: false, contaminated: false },
    event.config,
  );
  if (stableJson(after.memory) !== stableJson(event.after.memory))
    throw new Error("Proposed schedule failed server validation.");
  return {
    state: after,
    event: { ...event, effectiveAt: event.at, after, status: "canonical" },
  };
}
export function reconcileUndo(
  current: CardState,
  undo: UndoEvent,
  event: ReviewEvent,
): CardState {
  if (
    current.head !== event.id ||
    undo.reviewId !== event.id ||
    event.status === "undone"
  )
    throw new Error(
      "Undo conflicts with a later review. The request is preserved for reconciliation.",
    );
  return { ...event.before, version: current.version + 1, head: undo.id };
}
