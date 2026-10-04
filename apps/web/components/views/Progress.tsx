"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { useLibrary } from "../LibraryProvider";
import { PageTitle, Notice } from "../ui";
import { studyDay } from "@recall/scheduler";
import { useClock } from "../../features/useClock";
import { evidence } from "@recall/learning";
export default function Progress() {
  const { db, prefs } = useLibrary();
  useClock();
  const reviews = useLiveQuery(() => db.reviews.toArray(), [db]) ?? [];
  const attempts = useLiveQuery(() => db.attempts.toArray(), [db]) ?? [];
  const activities = useLiveQuery(() => db.activities.toArray(), [db]) ?? [];
  const exposures = useLiveQuery(() => db.exposures.count(), [db]) ?? 0;
  const valid = reviews.filter(
    (r) => r.status !== "undone" && r.status !== "concurrent",
  );
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(
      `${studyDay(new Date().toISOString(), prefs.timezone, prefs.rollover)}T12:00:00Z`,
    );
    d.setUTCDate(d.getUTCDate() - 13 + i);
    const date = d.toISOString().slice(0, 10);
    return {
      date,
      label: d.toLocaleDateString("en", { weekday: "short" }),
      count: valid.filter((r) => r.studyDay === date).length,
    };
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  const delayed = valid.filter(
    (r) =>
      r.before.memory.last_review &&
      r.studyDay !==
        studyDay(r.before.memory.last_review, prefs.timezone, prefs.rollover),
  );
  const successDays = new Set(
    delayed.filter((r) => r.rating !== "again").map((r) => r.studyDay),
  ).size;
  return (
    <>
      <PageTitle
        eyebrow="EVIDENCE, OVER TIME"
        title="See the practice adding up."
        description="A record of what you did, with room for what we don’t know yet."
      />
      <div className="progress-stats">
        <section className="panel">
          <span className="eyebrow">ORIGINAL RECALL</span>
          <strong>{valid.length}</strong>
          <p>qualifying reviews recorded</p>
        </section>
        <section className="panel">
          <span className="eyebrow">DELAYED SUCCESS</span>
          <strong>{successDays}</strong>
          <p>different days with successful later recall</p>
        </section>
        <section className="panel">
          <span className="eyebrow">ACTIVE TIME</span>
          <strong>
            {Math.round(valid.reduce((n, r) => n + r.durationMs, 0) / 60000)}
            <small> min</small>
          </strong>
          <p>spent on original reviews</p>
        </section>
      </div>
      <section className="panel history-chart">
        <div className="section-heading">
          <h2>A little, often.</h2>
          <span className="muted">Last 14 days</span>
        </div>
        <div
          className="bar-chart"
          role="img"
          aria-label={days
            .map((d) => `${d.date}: ${d.count} reviews`)
            .join("; ")}
        >
          {days.map((d) => (
            <div key={d.date} className="bar-column">
              <span>{d.count || ""}</span>
              <div className="bar-track">
                <div
                  style={{
                    height: `${Math.max(d.count ? 4 : 0, (d.count / max) * 100)}%`,
                  }}
                />
              </div>
              <small>{d.label}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Different kinds of evidence</h2>
        <p className="muted">
          Recognition, explanation, and application are different abilities. One
          does not automatically establish another.
        </p>
        <div className="evidence-list">
          {evidence(attempts, activities).map((e) => (
            <div key={e.dimension}>
              <span>
                {e.dimension === "apply"
                  ? "Application"
                  : e.dimension === "explain"
                    ? "Explanation"
                    : e.dimension === "discriminate"
                      ? "Discrimination"
                      : e.dimension === "recognition"
                        ? "Recognition (multiple choice)"
                        : "Alternate unaided recall"}
              </span>
              <strong>{e.observations} observations</strong>
            </div>
          ))}
          <div>
            <span>Assisted practice</span>
            <strong>
              {attempts.filter((a) => a.assistance).length} attempts
            </strong>
          </div>
          <div>
            <span>Recorded exposures</span>
            <strong>{exposures}</strong>
          </div>
          <div>
            <span>Uncertain or disputed</span>
            <strong>
              {
                attempts.filter((a) => a.grade === "uncertain" || a.dispute)
                  .length
              }{" "}
              attempts
            </strong>
          </div>
        </div>
      </section>
      <Notice>
        These records describe your practice. They do not predict an exam score
        or clinical competence. Same-session corrections are not evidence of
        durable mastery.
      </Notice>
    </>
  );
}
