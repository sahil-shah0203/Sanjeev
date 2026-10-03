import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { fsrs, createEmptyCard, Rating } from "ts-fsrs";
import {
  freshState,
  transition,
  preview,
  studyDay,
  nextRollover,
  qualifies,
} from "@recall/scheduler";
import {
  renderCloze,
  parseCloze,
  renderCard,
  compatibility,
} from "@recall/card-renderer";
import { safeHtml } from "../packages/card-renderer/src/sanitize";
import {
  occlusionShapes,
  visibleMasks,
} from "../packages/card-renderer/src/occlusion";
import {
  deterministicGrade,
  eligibleActivity,
  validateActivity,
} from "@recall/learning";
import { reconcileReview, reconcileUndo } from "@recall/sync";
import { FixtureProvider } from "@recall/ai";
import { demoBundle } from "../apps/web/features/demo";
import {
  id,
  type Activity,
  type ReviewEvent,
  type StudySession,
} from "@recall/domain";
const at = "2026-10-03T15:00:00.000Z";
const q = {
  original: true,
  attempted: true,
  assisted: false,
  contaminated: false,
};
describe("original scheduling boundary", () => {
  it("matches pinned FSRS transitions across learning and review states, for all ratings", () => {
    let state = freshState("card", at);
    let date = at;
    for (let step = 0; step < 4; step++) {
      for (const [index, rating] of [
        "again",
        "hard",
        "good",
        "easy",
      ].entries()) {
        const result = transition(state, rating as any, date, "event", q);
        const input = {
          ...state.memory,
          due: new Date(state.memory.due),
          last_review: state.memory.last_review
            ? new Date(state.memory.last_review)
            : undefined,
        };
        const reference = fsrs({
          enable_fuzz: false,
          request_retention: 0.9,
          enable_short_term: true,
          learning_steps: ["1m", "10m"],
          relearning_steps: ["10m"],
        }).next(input, new Date(date), (index + 1) as Rating.Again);
        expect(result.memory).toEqual(
          JSON.parse(JSON.stringify(reference.card)),
        );
      }
      state = transition(state, "good", date, id(), q);
      date = state.memory.due;
    }
  });
  it("does not mutate state during preview and is deterministic", () => {
    const state = freshState("card", at);
    const snapshot = JSON.stringify(state);
    expect(preview(state, at)).toEqual(preview(state, at));
    expect(JSON.stringify(state)).toBe(snapshot);
  });
  it("rejects generated, hinted, unattempted and exposed success", () => {
    for (const changed of [
      { original: false },
      { attempted: false },
      { assisted: true },
      { contaminated: true },
    ])
      expect(() =>
        transition(freshState("card", at), "good", at, "event", {
          ...q,
          ...changed,
        }),
      ).toThrow();
    expect(
      qualifies({ ...q, assisted: true, confirmedFailure: true }, "again"),
    ).toBe(true);
    expect(
      qualifies({ ...q, original: false, confirmedFailure: true }, "again"),
    ).toBe(false);
  });
  it("handles rollover across DST without subtracting fixed UTC hours", () => {
    expect(studyDay("2026-03-08T08:30:00Z", "America/Chicago", 4)).toBe(
      "2026-03-07",
    );
    expect(studyDay("2026-03-08T09:00:00Z", "America/Chicago", 4)).toBe(
      "2026-03-08",
    );
    expect(studyDay("2026-11-01T07:30:00Z", "America/Chicago", 4)).toBe(
      "2026-10-31",
    );
    const rollover = nextRollover("2026-11-01T07:30:00Z", "America/Chicago", 4);
    expect(new Date(rollover).getTime()).toBeCloseTo(
      new Date("2026-11-01T10:00:00Z").getTime(),
      -3,
    );
  });
});
describe("safe prompts", () => {
  it("hides all repeated target deletions and preserves sibling targets", () => {
    const question = renderCloze(
      "A {{c1::<b>hidden</b>::hint}} B {{c1::also-secret}} C {{c2::visible}}",
      1,
      false,
      0,
    );
    expect(question).not.toContain("hidden");
    expect(question).not.toContain("also-secret");
    expect(question).toContain("[hint]");
    expect(question).toContain("visible");
    expect(renderCloze("{{c1::first}} {{c1::second}}", 1, false, 1)).toContain(
      "first",
    );
    expect(
      renderCloze("{{c1::first}} {{c1::second}}", 1, false, 1),
    ).not.toContain("second");
  });
  it("rejects nested and unclosed clozes", () => {
    expect(() => parseCloze("{{c1::a {{c2::b}}}}")).toThrow();
    expect(() => parseCloze("{{c1::unfinished")).toThrow();
  });
  it("blocks script, CSS, network, event handlers, forms, and title leakage", () => {
    const win = new JSDOM("").window;
    const html = safeHtml(
      '<style>@import "https://evil.invalid/a";</style><script>alert(1)</script><img src="https://evil.invalid/pixel" onerror="alert(1)"><span title="secret" style="background:url(https://evil.invalid)">Prompt</span><iframe src="https://evil.invalid"></iframe><img src="local.png"><audio src="x.mp3" autoplay></audio>',
      new Map([
        ["local.png", "blob:local"],
        ["x.mp3", "blob:audio"],
      ]),
      win as unknown as Window,
    );
    expect(html).not.toMatch(
      /evil\.invalid|onerror|<script|<style|<iframe|title=|autoplay|style=/,
    );
    expect(html).toContain("blob:local");
    expect(html).toContain("controls");
    win.close();
  });
  it("renders reversed conditions and FrontSide without executing custom scripts", async () => {
    const b = await demoBundle();
    const n = { ...b.notes[0], fields: ["Question", "Answer", "yes"] };
    const t = {
      ...b.types[0],
      kind: "basic" as const,
      fields: ["Front", "Back", "Reverse"],
      templates: [
        {
          name: "Reversed",
          ord: 1,
          front: "{{#Reverse}}{{Back}}{{/Reverse}}",
          back: "{{FrontSide}}<hr>{{text:Front}}",
        },
      ],
    };
    expect(renderCard(t, n, 1, false).html).toBe("Answer");
    expect(renderCard(t, n, 1, true).html).toContain("Question");
    expect(
      compatibility(
        {
          ...t,
          templates: [
            { ...t.templates[0], front: "<script>doSomething()</script>" },
          ],
        },
        n,
        1,
      ).supported,
    ).toBe(false);
  });
  it("requires precise supported image masks and keeps other masks in hide-all mode", () => {
    const shapes = occlusionShapes(
      "{{c1::image-occlusion:rect:left=.1:top=.2:width=.3:height=.4:oi=1}}<br>{{c2::image-occlusion:ellipse:left=.6:top=.1:rx=.1:ry=.1:oi=1}}",
      1,
    );
    expect(visibleMasks(shapes, 1, false)).toHaveLength(2);
    expect(visibleMasks(shapes, 1, true)).toHaveLength(1);
    expect(shapes[0]).toMatchObject({
      left: 0.1,
      top: 0.2,
      width: 0.3,
      height: 0.4,
    });
    expect(() =>
      occlusionShapes(
        "{{c1::image-occlusion:rect:left=10:width=.2:height=.2}}",
        1,
      ),
    ).toThrow();
    expect(() =>
      occlusionShapes(
        "{{c1::image-occlusion:rect:left=.1:top=.1:width=.2:height=.2:angle=10}}",
        1,
      ),
    ).toThrow();
  });
});
describe("learning policy and conflicts", () => {
  it("enforces both count/time caps and preserves meaningful negation", async () => {
    const b = await demoBundle();
    const result = await new FixtureProvider().generate(b.notes, "recall");
    const a = {
      ...result.activity!,
      status: "human_approved" as const,
      reviewerId: id(),
      approvedHash: "test",
    };
    const s: StudySession = {
      id: id(),
      deckId: "",
      startedAt: at,
      updatedAt: at,
      budgetMinutes: 15,
      activeMs: 0,
      reviews: 10,
      checks: 0,
      interventionMs: 0,
      teachbacks: 0,
      excluded: [],
      completed: false,
      seed: "test",
      policy: "1",
    };
    expect(eligibleActivity(a, s, b.notes, new Set(), 0)).toBe(true);
    expect(
      eligibleActivity(a, { ...s, reviews: 9 }, b.notes, new Set(), 0),
    ).toBe(false);
    expect(
      eligibleActivity(
        a,
        { ...s, interventionMs: 134000 },
        b.notes,
        new Set(),
        0,
      ),
    ).toBe(false);
    expect(eligibleActivity(a, s, b.notes, new Set([b.notes[0].id]), 0)).toBe(
      false,
    );
    expect(
      deterministicGrade(
        { ...a, acceptedAnswers: ["positive"] },
        "not positive",
      ).grade,
    ).toBe("uncertain");
    expect(
      validateActivity(
        { ...a, sources: [{ ...a.sources[0], version: "wrong" }] },
        b.notes,
      ),
    ).not.toHaveLength(0);
  });
  it("retains stale branches without double-crediting or undoing newer reviews", () => {
    const before = freshState("card", at);
    const eventId = id();
    const after = transition(before, "good", at, eventId, q);
    const event: ReviewEvent = {
      id: eventId,
      cardId: "card",
      noteId: "n",
      sessionId: "s",
      deviceId: "d",
      sequence: 1,
      parent: null,
      baseVersion: 0,
      at,
      effectiveAt: at,
      contentVersion: "v",
      rating: "good",
      before,
      after,
      config: after.config,
      status: "pending",
      durationMs: 1000,
      studyDay: "2026-10-03",
    };
    expect(reconcileReview(before, event, at).event.status).toBe("canonical");
    const stale = { ...event, id: id() };
    expect(reconcileReview(after, stale, at).event.status).toBe("concurrent");
    expect(reconcileReview(after, stale, at).state).toEqual(after);
    expect(() =>
      reconcileUndo(
        { ...after, head: "newer" },
        { id: id(), reviewId: eventId, cardId: "card", at, restored: before },
        event,
      ),
    ).toThrow();
  });
});
