import { it, expect } from "vitest";
import { demoBundle } from "../apps/web/features/demo";
import { defaults } from "@recall/domain";
import { planHistory, reviewDue } from "../packages/scheduler/src/migration";
import { studyDay } from "@recall/scheduler";
async function historical() {
  const b = await demoBundle();
  b.cards = b.cards.slice(0, 1);
  b.report.rawCollection.crt = Date.parse("2026-03-01T06:00:00.000Z") / 1000;
  b.cards[0].raw = {
    type: 2,
    queue: 2,
    reps: 3,
    odid: 0,
    due: 10,
    factor: 2500,
  };
  b.report.history = [
    {
      id: String(Date.parse("2026-03-01T18:00:00Z")),
      cid: b.cards[0].originalId,
      ease: 3,
      type: 0,
    },
    {
      id: String(Date.parse("2026-03-01T18:10:00Z")),
      cid: b.cards[0].originalId,
      ease: 3,
      type: 0,
    },
    {
      id: String(Date.parse("2026-03-05T18:00:00Z")),
      cid: b.cards[0].originalId,
      ease: 3,
      type: 1,
    },
  ];
  return b;
}
const prefs = { ...defaults(), timezone: "America/Chicago", rollover: 4 };
it("replays complete standard histories while preserving the first due calendar day across DST", async () => {
  const b = await historical(),
    p = planHistory(b, prefs);
  expect(p.reasons).toEqual([]);
  expect(p.supported).toBe(true);
  expect(p.replayedReviews).toBe(3);
  expect(p.states[0].memory.reps).toBe(3);
  expect(p.states[0].memory.stability).toBeGreaterThan(0);
  expect(p.states[0].origin).toBe("replay");
  expect(p.preview[0].sourceDay).toBe("2026-03-11");
  expect(p.states[0].memory.due).toBe("2026-03-11T09:00:00.000Z");
  expect(studyDay(p.states[0].memory.due, prefs.timezone, 4)).toBe(
    "2026-03-11",
  );
});
it("does not map SM-2 ease factors into FSRS memory", async () => {
  const b = await historical(),
    first = planHistory(b, prefs);
  b.cards[0].raw.factor = 1300;
  expect(planHistory(b, prefs).states[0].memory).toEqual(
    first.states[0].memory,
  );
});
it("rejects incomplete, filtered, manually rescheduled, or ambiguous learning histories without changing source data", async () => {
  for (const change of ["partial", "filtered", "manual", "learning"]) {
    const b = await historical();
    if (change === "partial") b.report.history.pop();
    if (change === "filtered") b.cards[0].raw.odid = 123;
    if (change === "manual") b.report.history[2].type = 4;
    if (change === "learning") b.cards[0].raw.type = 1;
    const original = JSON.stringify(b);
    expect(planHistory(b, prefs).supported).toBe(false);
    expect(JSON.stringify(b)).toBe(original);
  }
});
it("rejects timestamp-like due values instead of interpreting them as days", () => {
  expect(() => reviewDue(1700000000, 1800000000, "UTC", 4)).toThrow();
});
