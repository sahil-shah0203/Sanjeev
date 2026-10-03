"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useClock } from "../../features/useClock";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowRight,
  BookOpen,
  Clock3,
  Layers,
  Upload,
  Check,
  ArrowUpRight,
  Sprout,
} from "lucide-react";
import { useLibrary } from "../LibraryProvider";
import { commitImport, eligibleCards, startSession } from "../../lib/db/local";
import { studyDay } from "@recall/scheduler";
import { demoBundle } from "../../features/demo";
import { PageTitle, Notice } from "../ui";
export default function Today() {
  const { db, prefs } = useLibrary();
  const tick = useClock();
  const router = useRouter();
  const [budget, setBudget] = useState(prefs.budgetMinutes);
  useEffect(() => setBudget(prefs.budgetMinutes), [prefs.budgetMinutes]);
  const [scope, setScope] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const decks = useLiveQuery(() => db.decks.toArray(), [db]) ?? [];
  const cards = useLiveQuery(() => db.cards.toArray(), [db]) ?? [];
  const eligible =
    useLiveQuery(
      () => eligibleCards(db, { deckId: scope, excluded: [] }),
      [db, tick, scope],
    ) ?? [];
  const reviews = useLiveQuery(() => db.reviews.toArray(), [db]) ?? [];
  const sessions =
    useLiveQuery(
      () => db.sessions.orderBy("updatedAt").reverse().toArray(),
      [db],
    ) ?? [];
  const due = eligible.filter(
    (x) => (!scope || x.card.deckId === scope) && x.state.memory.reps > 0,
  );
  const fresh = eligible.filter(
    (x) => (!scope || x.card.deckId === scope) && x.state.memory.reps === 0,
  );
  const recent = reviews.filter(
    (r) =>
      r.studyDay ===
        studyDay(new Date().toISOString(), prefs.timezone, prefs.rollover) &&
      r.status !== "undone" &&
      r.status !== "concurrent",
  );
  const resume = sessions.find((s) => !s.completed && s.reviews > 0);
  const begin = async () => {
    setBusy(true);
    try {
      const session = await startSession(db, scope, budget);
      router.push(`/study/${session.id}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const demo = async () => {
    setBusy(true);
    try {
      await commitImport(db, await demoBundle());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add demo.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow={new Intl.DateTimeFormat("en", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })
          .format(new Date())
          .toUpperCase()}
        title="A fresh space to remember."
        description="Pick up where you left off. Keep your next step small."
        action={
          <Link className="button secondary" href="/import">
            <Upload size={16} />
            Import deck
          </Link>
        }
      />
      {error && <Notice error>{error}</Notice>}
      <div className="today-grid">
        <section className="study-plan">
          <div className="plan-top">
            <span className="pill">
              <span className="status-dot" />
              {cards.length ? "YOUR NEXT SESSION" : "START WITH WHAT YOU KNOW"}
            </span>
            <BookOpen size={25} strokeWidth={1.4} />
          </div>
          <h2>
            {cards.length
              ? "A little practice,\na lasting habit."
              : "Your cards.\nA clearer routine."}
          </h2>
          <p>
            {cards.length
              ? "A focused round of recall, paced around your day."
              : "Bring your Anki decks into a calm space for focused daily practice."}
          </p>
          {cards.length ? (
            <>
              <div className="plan-count">
                <strong>{due.length + fresh.length}</strong>
                <span>
                  cards available now
                  <br />
                  <small>
                    {due.length} due · {fresh.length} new within your limit
                  </small>
                </span>
              </div>
              <div className="plan-controls">
                <label>
                  Study from
                  <select
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                  >
                    <option value="">All decks</option>
                    {decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset>
                  <legend>Make time for</legend>
                  <div className="segmented">
                    {[5, 15, 30, 0].map((n) => (
                      <button
                        key={n}
                        aria-pressed={budget === n}
                        className={budget === n ? "selected" : ""}
                        onClick={() => setBudget(n)}
                      >
                        {n ? `${n} min` : "Untimed"}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
              <button
                className="button primary plan-start"
                disabled={busy || due.length + fresh.length === 0}
                onClick={begin}
              >
                {due.length + fresh.length
                  ? "Start a session"
                  : "You’re up to date"}
                <ArrowRight size={18} />
              </button>
              {resume && (
                <Link className="resume-link" href={`/study/${resume.id}`}>
                  Resume unfinished session <ArrowUpRight size={14} />
                </Link>
              )}
            </>
          ) : (
            <>
              <div className="welcome-steps">
                <span>
                  <Check size={15} />
                  No account needed
                </span>
                <span>
                  <Check size={15} />
                  Your original cards and media
                </span>
                <span>
                  <Check size={15} />
                  Review offline after setup
                </span>
              </div>
              <Link href="/import" className="button primary plan-start">
                Import an Anki deck
                <ArrowRight size={18} />
              </Link>
              <button
                className="text-button demo-button"
                onClick={demo}
                disabled={busy}
              >
                Or try 6 demonstration cards
              </button>
            </>
          )}
        </section>
        <div className="today-aside">
          <section className="panel day-panel">
            <div className="section-label">
              <span>YOUR DAY, AT A GLANCE</span>
              <Clock3 size={17} />
            </div>
            <div className="day-stats">
              <div>
                <strong>{recent.length}</strong>
                <span>reviews today</span>
              </div>
              <div>
                <strong>
                  {Math.round(
                    recent.reduce((s, r) => s + r.durationMs, 0) / 60000,
                  )}
                  <small> min</small>
                </strong>
                <span>active recall time</span>
              </div>
            </div>
            <div className="quiet-rule" />
            <p>
              {recent.length
                ? "Every completed review is saved on this device."
                : "A blank slate is a good place to start."}
            </p>
          </section>
          <section className="learning-note">
            <span className="note-icon">
              <Sprout size={24} strokeWidth={1.5} />
            </span>
            <p className="eyebrow">A SMALL STUDY REMINDER</p>
            <h3>Give recall a moment.</h3>
            <p>
              Try to bring the answer to mind before revealing it. A difficult
              attempt can still be useful practice.
            </p>
            <span className="note-foot">RECALL FIRST. THEN CHECK.</span>
          </section>
        </div>
      </div>
      <section className="deck-section">
        <div className="section-heading">
          <h2>
            Your library{" "}
            <span className="count-chip">
              {decks.filter((d) => cards.some((c) => c.deckId === d.id)).length}
            </span>
          </h2>
          <Link href="/decks" className="text-link">
            View all decks
            <ArrowRight size={15} />
          </Link>
        </div>
        {cards.length ? (
          <div className="deck-cards">
            {decks
              .filter((d) => cards.some((c) => c.deckId === d.id))
              .slice(0, 3)
              .map((d) => (
                <Link key={d.id} href={`/decks/${d.id}`} className="deck-tile">
                  <span className="deck-icon">
                    <Layers size={22} />
                  </span>
                  <h3>{d.name.split("::").at(-1)}</h3>
                  <p>{cards.filter((c) => c.deckId === d.id).length} cards</p>
                  <div>
                    <span>
                      {eligible.filter((c) => c.card.deckId === d.id).length}{" "}
                      available now
                    </span>
                    <ArrowUpRight size={17} />
                  </div>
                </Link>
              ))}
          </div>
        ) : (
          <Link className="empty-library" href="/import">
            <span className="deck-icon">
              <Layers size={23} />
            </span>
            <div>
              <h3>Your next chapter starts here.</h3>
              <p>Import a .apkg file to build your personal library.</p>
            </div>
            <ArrowRight size={20} />
          </Link>
        )}
      </section>
    </>
  );
}
