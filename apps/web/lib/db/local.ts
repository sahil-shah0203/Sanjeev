import Dexie, { type Table } from "dexie";
import {
  defaults,
  id,
  now,
  type Activity,
  type Attempt,
  type CardState,
  type ContentReport,
  type Deck,
  type Entity,
  type Exposure,
  type ImportBundle,
  type ImportReport,
  type MediaAsset,
  type Mutation,
  type Note,
  type NoteType,
  type Preferences,
  type ReviewEvent,
  type RecallRating,
  type SourceCard,
  type StudySession,
  type UndoEvent,
  hash,
} from "@recall/domain";
import {
  configFor,
  freshState,
  nextRollover,
  studyDay,
  transition,
  type Qualification,
} from "@recall/scheduler";
import { planHistory } from "@recall/scheduler";
import { compatibility } from "@recall/card-renderer";

export class Library extends Dexie {
  imports!: Table<ImportReport, string>;
  decks!: Table<Deck, string>;
  types!: Table<NoteType, string>;
  notes!: Table<Note, string>;
  cards!: Table<SourceCard, string>;
  media!: Table<MediaAsset, string>;
  states!: Table<CardState, string>;
  reviews!: Table<ReviewEvent, string>;
  exposures!: Table<Exposure, string>;
  sessions!: Table<StudySession, string>;
  activities!: Table<Activity, string>;
  attempts!: Table<Attempt, string>;
  reports!: Table<ContentReport, string>;
  preferences!: Table<Preferences, string>;
  undos!: Table<UndoEvent, string>;
  outbox!: Table<Mutation, string>;
  meta!: Table<{ id: string; value: unknown }, string>;
  constructor(public owner: string) {
    super(`recall-v1-${owner}`);
    this.version(1).stores({
      imports: "id,hash,status,namespace",
      decks: "id,namespace,importId,name",
      types: "id",
      notes: "id,namespace,typeId,*tags",
      cards: "id,namespace,noteId,deckId,supported",
      media: "id,namespace,hash,[namespace+name]",
      states: "id,memory.due",
      reviews: "id,cardId,sessionId,at,studyDay",
      exposures: "id,noteId,cardId,sessionId,at",
      sessions: "id,updatedAt",
      activities: "id,status",
      attempts: "id,activityId,at",
      reports: "id,status",
      preferences: "id",
      undos: "id,reviewId",
      outbox: "id,at",
      meta: "id",
    });
  }
}
export const syncEntities: Entity[] = [
  "imports",
  "decks",
  "types",
  "notes",
  "cards",
  "states",
  "exposures",
  "sessions",
  "activities",
  "attempts",
  "reports",
  "preferences",
  "undos",
];
export function serializeEntity(entity: string, value: unknown): unknown {
  if (entity === "imports") {
    const { originalPackage, ...rest } = value as ImportReport;
    return rest;
  }
  return value;
}
export async function enqueue(
  db: Library,
  entity: Entity,
  entityId: string,
  value: unknown,
  kind: Mutation["kind"] = "put",
  baseVersion = 0,
) {
  await db.outbox.put({
    id: id(),
    entity,
    entityId,
    value: serializeEntity(entity, value),
    kind,
    baseVersion,
    at: now(),
  });
}
export async function preferences(db: Library) {
  return (await db.preferences.get("preferences")) ?? defaults();
}
export async function cleanupStaging(db: Library) {
  const expired = await db.meta
    .filter(
      (m) =>
        m.id.startsWith("staging:") &&
        Date.parse((m.value as { at: string }).at) < Date.now() - 86400000,
    )
    .toArray();
  for (const item of expired) {
    const namespace = (item.value as { namespace: string }).namespace;
    await db.transaction("rw", db.media, db.meta, db.imports, async () => {
      if (!(await db.imports.where("namespace").equals(namespace).count()))
        await db.media.where("namespace").equals(namespace).delete();
      await db.meta.delete(item.id);
    });
  }
}
export async function savePreferences(db: Library, p: Preferences) {
  await db.transaction("rw", db.preferences, db.outbox, async () => {
    await db.preferences.put(p);
    await enqueue(db, "preferences", p.id, p);
  });
}
export async function updateSession(
  db: Library,
  sessionId: string,
  changes: Partial<StudySession>,
) {
  await db.transaction("rw", db.sessions, db.outbox, async () => {
    const existing = await db.sessions.get(sessionId);
    if (!existing) throw new Error("Session no longer exists.");
    const updated = {
      ...existing,
      ...changes,
      id: existing.id,
      updatedAt: now(),
    };
    await db.sessions.put(updated);
    await enqueue(db, "sessions", sessionId, updated);
  });
}
export async function commitImport(
  db: Library,
  bundle: ImportBundle,
  mode: "fresh" | "preserve_due" | "replay" = "fresh",
) {
  const duplicate = await db.imports
    .where("hash")
    .equals(bundle.report.hash)
    .filter((x) => x.status === "completed")
    .first();
  if (duplicate)
    throw new Error(
      "This exact package is already imported. Your reviews have been preserved.",
    );
  const prefs = await preferences(db);
  const at = now();
  const migration = mode === "replay" ? planHistory(bundle, prefs, at) : null;
  if (migration && !migration.supported)
    throw new Error(migration.reasons.slice(0, 5).join(" "));
  const states =
    migration?.states ??
    bundle.cards.map((c) => {
      const state = freshState(c.id, at, configFor(prefs.retention));
      if (mode === "preserve_due") {
        if (
          Number(c.raw.type) !== 2 ||
          Number(c.raw.odid) !== 0 ||
          Number(c.raw.due) < 0
        )
          throw new Error(
            "This package includes schedules outside the supported due-only migration. Choose fresh progress or export a selected review-only deck.",
          );
        const creation = Number(bundle.report.rawCollection.crt) * 1000;
        const due = new Date(creation + Number(c.raw.due) * 86400000);
        if (!Number.isFinite(due.getTime()))
          throw new Error("Collection due date could not be interpreted.");
        state.memory.due = due.toISOString();
        state.origin = "partial_due";
      }
      return state;
    });
  const report: ImportReport = {
    ...bundle.report,
    status: "completed",
    historyMode: mode,
  };
  await db.transaction(
    "rw",
    [
      db.imports,
      db.decks,
      db.types,
      db.notes,
      db.cards,
      db.states,
      db.media,
      db.outbox,
    ],
    async () => {
      if (
        await db.imports
          .where("hash")
          .equals(bundle.report.hash)
          .filter((x) => x.status === "completed")
          .count()
      )
        throw new Error("Already imported in another tab.");
      for (const [entity, values] of [
        ["decks", bundle.decks],
        ["types", bundle.types],
        ["notes", bundle.notes],
        ["cards", bundle.cards],
        ["states", states],
        ["imports", [report]],
      ] as const) {
        await db.table(entity).bulkPut(values);
        await db.outbox.bulkPut(
          values.map((value) => ({
            id: id(),
            entity,
            entityId: value.id,
            value: serializeEntity(entity, value),
            baseVersion: 0,
            kind: "put" as const,
            at,
          })),
        );
      }
      if (bundle.media.length) await db.media.bulkPut(bundle.media);
    },
  );
  await navigator.storage?.persist?.().catch(() => false);
}
export async function startSession(
  db: Library,
  deckId: string,
  budgetMinutes: number,
  aiQuestions = false,
): Promise<StudySession> {
  const at = now();
  const s: StudySession = {
    id: id(),
    deckId,
    startedAt: at,
    updatedAt: at,
    budgetMinutes,
    activeMs: 0,
    reviews: 0,
    checks: 0,
    interventionMs: 0,
    teachbacks: 0,
    excluded: [],
    completed: false,
    seed: id(),
    policy: "recall-1",
    aiQuestions: aiQuestions && budgetMinutes >= 5,
    aiRequests: 0,
  };
  await db.transaction("rw", db.sessions, db.outbox, async () => {
    await db.sessions.put(s);
    await enqueue(db, "sessions", s.id, s);
  });
  return s;
}
export async function eligibleCards(
  db: Library,
  session?: Pick<StudySession, "deckId" | "excluded">,
) {
  const prefs = await preferences(db);
  const [cards, states, reviews] = await Promise.all([
    db.cards.toArray(),
    db.states.where("memory.due").belowOrEqual(now()).toArray(),
    db.reviews
      .where("studyDay")
      .equals(studyDay(now(), prefs.timezone, prefs.rollover))
      .toArray(),
  ]);
  const stateMap = new Map(states.map((s) => [s.id, s]));
  const at = now();
  const newToday = new Set(
    reviews
      .filter(
        (e) =>
          e.before.memory.reps === 0 &&
          e.status !== "undone" &&
          e.status !== "concurrent",
      )
      .map((e) => e.cardId),
  ).size;
  let remainingNew = Math.max(0, prefs.newLimit - newToday);
  const candidates = cards
    .filter(
      (c) =>
        c.supported &&
        !c.suspended &&
        (!c.buriedUntil || c.buriedUntil <= at) &&
        (!session?.deckId || c.deckId === session.deckId) &&
        !session?.excluded.includes(c.id),
    )
    .map((c) => ({ card: c, state: stateMap.get(c.id)! }))
    .filter((x) => x.state && x.state.memory.due <= at);
  candidates.sort((a, b) => {
    const priority = (s: CardState) =>
      s.memory.state === 1 || s.memory.state === 3
        ? 0
        : s.memory.reps > 0
          ? 1
          : 2;
    return (
      priority(a.state) - priority(b.state) ||
      a.state.memory.due.localeCompare(b.state.memory.due) ||
      a.card.originalId.localeCompare(b.card.originalId)
    );
  });
  return candidates.filter(
    (x) => x.state.memory.reps > 0 || remainingNew-- > 0,
  );
}
export async function recordExposure(
  db: Library,
  card: SourceCard,
  sessionId: string,
  kind: Exposure["kind"],
  reviewId?: string,
) {
  const exposure: Exposure = {
    id: id(),
    cardId: card.id,
    noteId: card.noteId,
    sessionId,
    at: now(),
    kind,
    reviewId,
  };
  await db.transaction("rw", db.exposures, db.outbox, async () => {
    await db.exposures.put(exposure);
    await enqueue(db, "exposures", exposure.id, exposure);
  });
  return exposure;
}
export async function saveReview(
  db: Library,
  input: {
    card: SourceCard;
    state: CardState;
    session: StudySession;
    rating: RecallRating;
    qualification: Qualification;
    durationMs: number;
    contentVersion: string;
    eventId: string;
  },
) {
  const at = now(),
    prefs = await preferences(db);
  const deviceId = localStorage.getItem("recall-device") ?? id();
  localStorage.setItem("recall-device", deviceId);
  const run = () =>
    db.transaction(
      "rw",
      [
        db.states,
        db.reviews,
        db.exposures,
        db.outbox,
        db.cards,
        db.sessions,
        db.meta,
        db.notes,
      ],
      async () => {
        const existing = await db.reviews.get(input.eventId);
        if (existing) return existing;
        const currentCard = await db.cards.get(input.card.id);
        if (
          !currentCard?.supported ||
          currentCard.suspended ||
          (currentCard.buriedUntil && currentCard.buriedUntil > at)
        )
          throw new Error(
            "This card is no longer available for review. Return to Today to refresh the queue.",
          );
        const state = await db.states.get(input.card.id);
        if (
          !state ||
          state.version !== input.state.version ||
          state.head !== input.state.head
        )
          throw new Error(
            "This card changed in another tab or device. Reload it before rating.",
          );
        const note = await db.notes.get(input.card.noteId);
        if (note?.version !== input.contentVersion)
          throw new Error(
            "The card was edited while you studied. Reload the prompt.",
          );
        const sequence =
          Number((await db.meta.get("sequence"))?.value ?? 0) + 1;
        await db.meta.put({ id: "sequence", value: sequence });
        const after = transition(
          state,
          input.rating,
          at,
          input.eventId,
          input.qualification,
          configFor(prefs.retention),
        );
        const event: ReviewEvent = {
          id: input.eventId,
          cardId: input.card.id,
          noteId: input.card.noteId,
          sessionId: input.session.id,
          deviceId,
          sequence,
          parent: state.head,
          baseVersion: state.version,
          at,
          effectiveAt: at,
          contentVersion: input.contentVersion,
          rating: input.rating,
          before: state,
          after,
          config: after.config,
          status: "pending",
          durationMs: input.durationMs,
          studyDay: studyDay(at, prefs.timezone, prefs.rollover),
        };
        await db.reviews.add(event);
        await db.states.put(after);
        await db.outbox.add({
          id: event.id,
          kind: "review",
          entity: "reviews",
          entityId: event.id,
          value: event,
          baseVersion: state.version,
          at,
        });
        const exposure: Exposure = {
          id: id(),
          cardId: input.card.id,
          noteId: input.card.noteId,
          sessionId: input.session.id,
          at,
          kind: "reveal",
          reviewId: event.id,
        };
        await db.exposures.put(exposure);
        await enqueue(db, "exposures", exposure.id, exposure);
        const session =
          (await db.sessions.get(input.session.id)) ?? input.session;
        const updatedSession = {
          ...session,
          reviews: session.reviews + 1,
          activeMs: session.activeMs + input.durationMs,
          updatedAt: at,
          lastCardId: input.card.id,
        };
        await db.sessions.put(updatedSession);
        await enqueue(db, "sessions", session.id, updatedSession);
        if (prefs.burySiblings) {
          const siblings = await db.cards
            .where("noteId")
            .equals(input.card.noteId)
            .filter((c) => c.id !== input.card.id)
            .toArray();
          for (const c of siblings) {
            const updated = {
              ...c,
              buriedUntil: nextRollover(at, prefs.timezone, prefs.rollover),
            };
            await db.cards.put(updated);
            await enqueue(db, "cards", c.id, updated);
          }
        }
        return event;
      },
    );
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(`recall-${db.owner}-${input.card.id}`, run)
    : run();
}
export async function undoReview(db: Library, eventId: string) {
  await db.transaction(
    "rw",
    [db.reviews, db.states, db.undos, db.outbox, db.sessions],
    async () => {
      const event = await db.reviews.get(eventId);
      if (!event || event.status === "undone")
        throw new Error("There is no review to undo.");
      const state = await db.states.get(event.cardId);
      if (state?.head !== event.id)
        throw new Error(
          "A later review exists. Undo cannot overwrite newer work.",
        );
      const undoId = id();
      const restored = {
        ...event.before,
        version: state.version + 1,
        head: undoId,
      };
      const undo: UndoEvent = {
        id: undoId,
        reviewId: event.id,
        cardId: event.cardId,
        at: now(),
        restored,
      };
      await db.undos.add(undo);
      await db.reviews.update(event.id, { status: "undone" });
      await db.states.put(restored);
      await db.outbox.add({
        id: undoId,
        kind: "undo",
        entity: "undos",
        entityId: undoId,
        value: undo,
        baseVersion: state.version,
        at: undo.at,
      });
      const s = await db.sessions.get(event.sessionId);
      if (s) {
        const updated = {
          ...s,
          reviews: Math.max(0, s.reviews - 1),
          updatedAt: now(),
        };
        await db.sessions.put(updated);
        await enqueue(db, "sessions", s.id, updated);
      }
    },
  );
}
export async function updateCard(
  db: Library,
  card: SourceCard,
  changes: Partial<SourceCard>,
) {
  const updated = { ...card, ...changes, id: card.id };
  await db.transaction("rw", db.cards, db.outbox, async () => {
    await db.cards.put(updated);
    await enqueue(db, "cards", card.id, updated);
  });
}
export async function editNote(db: Library, note: Note, fields: string[]) {
  const version = await hash(JSON.stringify(fields));
  const updated = {
    ...note,
    fields,
    version,
    revisions: [
      ...note.revisions,
      { version: note.version, fields: note.fields, at: now() },
    ],
  };
  await db.transaction(
    "rw",
    [db.notes, db.types, db.cards, db.activities, db.outbox],
    async () => {
      const current = await db.notes.get(note.id);
      if (current?.version !== note.version)
        throw new Error("This note has changed. Open it again before saving.");
      await db.notes.put(updated);
      await enqueue(db, "notes", note.id, updated);
      const type = await db.types.get(note.typeId);
      if (type)
        for (const c of await db.cards
          .where("noteId")
          .equals(note.id)
          .toArray()) {
          const check = compatibility(type, updated, c.ord);
          const card = { ...c, ...check };
          await db.cards.put(card);
          await enqueue(db, "cards", card.id, card);
        }
      for (const a of await db.activities.toArray())
        if (a.sources.some((s) => s.noteId === note.id)) {
          const invalid = { ...a, status: "quarantined" as const };
          await db.activities.put(invalid);
          await enqueue(db, "activities", a.id, invalid);
        }
    },
  );
}
export async function reportContent(db: Library, report: ContentReport) {
  await db.transaction(
    "rw",
    [db.reports, db.activities, db.outbox],
    async () => {
      await db.reports.put(report);
      await enqueue(db, "reports", report.id, report);
      if (report.activityId) {
        const a = await db.activities.get(report.activityId);
        if (a) {
          const updated = { ...a, status: "quarantined" as const };
          await db.activities.put(updated);
          await enqueue(db, "activities", a.id, updated);
        }
      }
    },
  );
}
