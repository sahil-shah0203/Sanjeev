import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { FixtureProvider } from "@recall/ai";
import {
  selectActivity,
  eligibleActivity,
  evidence,
  validateActivity,
} from "@recall/learning";
import {
  id,
  type Activity,
  type ReviewEvent,
  type Attempt,
} from "@recall/domain";
import { demoBundle } from "../apps/web/features/demo";
import { Library, commitImport, startSession } from "../apps/web/lib/db/local";
import {
  openIntervention,
  saveAdaptiveAttempt,
  checkpointIntervention,
  recoverInterventions,
} from "../apps/web/features/adaptive";
const at = "2026-10-03T15:00:00.000Z";
async function setup() {
  const bundle = await demoBundle();
  const activities: Activity[] = [];
  for (const task of ["recall", "explain", "discriminate", "apply"] as const)
    for (const format of [
      "short_answer",
      "multiple_choice",
      "brief_explanation",
    ] as const) {
      const result = await new FixtureProvider().generate(
        [bundle.notes[0]],
        task,
        format,
      );
      activities.push({
        ...result.activity!,
        status: "human_approved",
        reviewerId: "fixture-reviewer",
        approvedHash: "fixture-only",
      });
    }
  const session = {
    id: id(),
    deckId: "",
    startedAt: at,
    updatedAt: at,
    budgetMinutes: 15,
    activeMs: 10000,
    reviews: 20,
    checks: 0,
    interventionMs: 0,
    teachbacks: 0,
    excluded: [],
    completed: false,
    seed: "fixed",
    policy: "test",
  };
  const review = (day: string) =>
    ({
      id: id(),
      noteId: bundle.notes[0].id,
      status: "canonical",
      rating: "again",
      at: `${day}T14:00:00.000Z`,
      studyDay: day,
    }) as ReviewEvent;
  const context = {
    session,
    notes: bundle.notes,
    activities,
    reviews: [review("2026-10-01"), review("2026-10-02")],
    attempts: [] as Attempt[],
    exposedNoteIds: new Set<string>(),
    overdue: 0,
    learningDue: false,
    at,
  };
  return { bundle, context, activities };
}
it("provides source-validated synthetic activities for every task and format, abstaining on medical text", async () => {
  const { bundle, activities } = await setup();
  for (const a of activities)
    expect(validateActivity(a, bundle.notes)).toEqual([]);
  expect(activities).toHaveLength(12);
  expect(
    (
      await new FixtureProvider().generate(
        [{ ...bundle.notes[0], fields: ["unverified medical statement", ""] }],
        "apply",
      )
    ).abstain,
  ).toBeTruthy();
});
it("requires distinct-day failures and respects time, count, backlog, source and learning-step boundaries", async () => {
  const { context, activities, bundle } = await setup();
  expect(selectActivity(context)?.reason).toContain("distinct study days");
  expect(
    selectActivity({
      ...context,
      reviews: [context.reviews[0], context.reviews[0]],
    }),
  ).toBeUndefined();
  expect(selectActivity({ ...context, learningDue: true })).toBeUndefined();
  expect(selectActivity({ ...context, overdue: 101 })).toBeUndefined();
  expect(
    selectActivity({
      ...context,
      exposedNoteIds: new Set([bundle.notes[0].id]),
    }),
  ).toBeUndefined();
  for (const changes of [
    { checks: 2 },
    { budgetMinutes: 4 },
    { interventionMs: 134000 },
    { activeMs: 900000 },
    { completed: true },
  ])
    expect(
      selectActivity({
        ...context,
        session: { ...context.session, ...changes },
      }),
    ).toBeUndefined();
  expect(
    eligibleActivity(
      activities.find((a) => a.format === "brief_explanation")!,
      { ...context.session, teachbacks: 1 },
      bundle.notes,
      new Set(),
      0,
    ),
  ).toBe(false);
});
it("rotates format deterministically within an objective without changing the cognitive task", async () => {
  const { context, activities } = await setup();
  const choices = activities.filter((a) => a.cognitiveTask === "recall");
  const first = selectActivity({ ...context, activities: choices })!;
  const attempt = {
    id: id(),
    activityId: first.activity.id,
    activityVersion: first.activity.version,
    at,
    grade: "correct",
    assistance: false,
    contaminated: false,
  } as Attempt;
  const next = selectActivity({
    ...context,
    activities: choices,
    attempts: [attempt],
  })!;
  expect(next.activity.format).not.toBe(first.activity.format);
  expect(next.activity.cognitiveTask).toBe("recall");
  expect(
    selectActivity({
      ...context,
      activities: [...choices].reverse(),
      attempts: [attempt],
    }),
  ).toEqual(next);
});
it("keeps recognition, assistance, uncertainty and disputes separate from unaided recall evidence", async () => {
  const { activities } = await setup();
  const a = activities.find(
    (a) => a.format === "multiple_choice" && a.cognitiveTask === "recall",
  )!;
  const attempt = {
    id: id(),
    activityId: a.id,
    activityVersion: a.version,
    grade: "correct",
    assistance: false,
    contaminated: false,
  } as Attempt;
  const results = evidence(
    [
      attempt,
      { ...attempt, assistance: true },
      { ...attempt, grade: "uncertain" },
      { ...attempt, dispute: "wrong" },
    ],
    activities,
  );
  expect(results.find((e) => e.dimension === "recognition")?.observations).toBe(
    1,
  );
  expect(results.find((e) => e.dimension === "recall")?.observations).toBe(0);
});
it("reserves checks on display, saves attempts idempotently, counts feedback time and recovers reloads without changing FSRS", async () => {
  const { bundle, context, activities } = await setup();
  const db = new Library(id());
  try {
    await commitImport(db, bundle);
    const session = await startSession(db, "", 15);
    await db.sessions.update(session.id, { reviews: 20 });
    await db.activities.bulkPut(activities);
    const before = await db.states.toArray();
    const entry = await openIntervention(
      db,
      session.id,
      activities[0],
      "distinct days",
    );
    expect((await db.sessions.get(session.id))?.checks).toBe(1);
    expect(await db.exposures.count()).toBe(1);
    await saveAdaptiveAttempt(db, session.id, entry.id, "three", 12000);
    await saveAdaptiveAttempt(db, session.id, entry.id, "three", 12000);
    expect(await db.attempts.count()).toBe(1);
    await checkpointIntervention(db, session.id, entry.id, 22000, "completed");
    expect((await db.sessions.get(session.id))?.interventionMs).toBe(22000);
    expect(await db.states.toArray()).toEqual(before);
    // Explicit help may exceed automatic caps but is labeled assisted exposure.
    const help = await openIntervention(
      db,
      session.id,
      activities[1],
      "requested",
      true,
    );
    await recoverInterventions(db, session.id);
    const restored = await db.sessions.get(session.id);
    expect(restored?.interventions?.find((i) => i.id === help.id)?.status).toBe(
      "interrupted",
    );
    expect(restored?.interventionMs).toBe(
      22000 + activities[1].expectedSeconds * 1000,
    );
    expect(restored?.checks).toBe(1);
  } finally {
    await db.delete();
  }
});
