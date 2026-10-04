"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  ArrowRight,
  Flag,
  Undo2,
  Check,
  BookOpen,
  Clock3,
  SkipForward,
} from "lucide-react";
import {
  errorMessage,
  id,
  now,
  type Activity,
  type Attempt,
  type CardState,
  type Note,
  type NoteType,
  type RecallRating,
  type SourceCard,
  type StudySession,
} from "@recall/domain";
import { clozeCount, oneByOne } from "@recall/card-renderer";
import { useClock } from "../../features/useClock";
import { intervalLabel, preview } from "@recall/scheduler";
import { selectActivity } from "@recall/learning";
import {
  openIntervention,
  checkpointIntervention,
  recoverInterventions,
  saveAdaptiveAttempt,
} from "../../features/adaptive";
import { useLibrary } from "../LibraryProvider";
import {
  eligibleCards,
  enqueue,
  updateSession,
  recordExposure,
  reportContent,
  saveReview,
  undoReview,
} from "../../lib/db/local";
import { Notice, Busy } from "../ui";
import CardContent from "../CardContent";
import AttemptFeedback from "../AttemptFeedback";
type Item = { card: SourceCard; state: CardState; note: Note; type: NoteType };
const ratings: RecallRating[] = ["again", "hard", "good", "easy"];
export default function Study() {
  const { db, prefs, syncStatus, features } = useLibrary();
  const routedPath = usePathname();
  const path =
    typeof window === "undefined" ? routedPath : window.location.pathname;
  const router = useRouter();
  const sessionId = path.split("/")[2];
  const session = useLiveQuery(
    () => db.sessions.get(sessionId ?? ""),
    [db, sessionId],
  );
  const [item, setItem] = useState<Item | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [count, setCount] = useState(0);
  const [attempted, setAttempted] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [lastCard, setLastCard] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [typed, setTyped] = useState("");
  const [activity, setActivity] = useState<Activity | null>(null);
  const [adaptiveAnswer, setAdaptiveAnswer] = useState("");
  const [adaptiveResult, setAdaptiveResult] = useState<Attempt | null>(null);
  const [intervention, setIntervention] = useState<{
    id: string;
    reason: string;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [helpNotice, setHelpNotice] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const exposureId = useRef("");
  const eventId = useRef(id());
  const activeMs = useRef(0);
  const lastInteraction = useRef(Date.now());
  const locked = useRef(false);
  const attemptedRef = useRef(true);
  const load = useCallback(
    async (preferred?: string) => {
      if (!sessionId) return;
      const s = await db.sessions.get(sessionId);
      if (!s) {
        setError(
          "This session is not on this device. Return to Today to start a session.",
        );
        setLoaded(true);
        return;
      }
      const queue = await eligibleCards(db, s);
      const selected = preferred
        ? (queue.find((x) => x.card.id === preferred) ?? queue[0])
        : queue[0];
      if (selected) {
        const note = await db.notes.get(selected.card.noteId);
        const type = note ? await db.types.get(note.typeId) : null;
        if (!note || !type)
          throw new Error(
            "This card is missing source data. Restore a backup.",
          );
        setItem({ ...selected, note, type });
      } else setItem(null);
      setRevealed(false);
      setCount(0);
      setAttempted(true);
      attemptedRef.current = true;
      setTyped("");
      setSourceOpen(false);
      setHelpNotice("");
      activeMs.current = 0;
      eventId.current = id();
      exposureId.current = "";
      setLoaded(true);
    },
    [db, sessionId],
  );
  useEffect(() => {
    void recoverInterventions(db, sessionId)
      .then(() => load())
      .catch((e) => setError(errorMessage(e)));
  }, [db, sessionId, load]);
  useEffect(() => {
    if (!intervention) return;
    const timer = setInterval(() => {
      setElapsed(activeMs.current);
      void checkpointIntervention(
        db,
        sessionId,
        intervention.id,
        activeMs.current,
      ).catch((e) => setError(errorMessage(e)));
    }, 5000);
    return () => clearInterval(timer);
  }, [db, sessionId, intervention]);
  useEffect(() => {
    if (item || activity || finished || !loaded) return;
    const timer = setInterval(
      () => void load().catch((e) => setError(errorMessage(e))),
      15000,
    );
    return () => clearInterval(timer);
  }, [item, activity, finished, loaded, load]);
  useEffect(() => {
    const touch = () => {
      lastInteraction.current = Date.now();
    };
    const interval = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastInteraction.current < 60000 &&
        !finished
      )
        activeMs.current += 1000;
    }, 1000);
    window.addEventListener("keydown", touch);
    window.addEventListener("pointerdown", touch);
    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("pointerdown", touch);
    };
  }, [finished]);
  const end = async () => {
    if (!session) return;
    await updateSession(db, session.id, { completed: true, updatedAt: now() });
    setFinished(true);
  };
  const expose = async (noAttempt = false) => {
    if (!item || !session || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if (noAttempt) {
        setAttempted(false);
        attemptedRef.current = false;
      }
      if (!exposureId.current) {
        const exposure = await recordExposure(
          db,
          item.card,
          session.id,
          noAttempt ? "no_attempt" : "reveal",
        );
        exposureId.current = exposure.id;
      }
      const total = oneByOne(item.type, item.note)
        ? clozeCount(item.type, item.note, item.card.ord)
        : 1;
      const next = count + 1;
      setCount(next);
      if (next >= total || noAttempt) setRevealed(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const skip = async (kind: "skip" | "source" = "skip") => {
    if (!item || !session || locked.current) return;
    locked.current = true;
    try {
      await recordExposure(db, item.card, session.id, kind);
      const s = await db.sessions.get(session.id);
      await updateSession(db, session.id, {
        excluded: [...(s?.excluded ?? []), item.card.id],
      });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
    }
  };
  const rate = async (rating: RecallRating) => {
    if (
      !item ||
      !session ||
      !revealed ||
      locked.current ||
      !attemptedRef.current
    )
      return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const exposures = await db.exposures
        .where("noteId")
        .equals(item.note.id)
        .filter(
          (e) =>
            e.sessionId === session.id ||
            Date.parse(e.at) > Date.now() - 30 * 60000,
        )
        .toArray();
      const contaminated = exposures.some(
        (e) =>
          e.id !== exposureId.current &&
          e.noteId === item.note.id &&
          (e.cardId !== item.card.id ||
            ["adaptive", "no_attempt", "source", "hint"].includes(e.kind)),
      );
      if (contaminated && rating !== "again") {
        setError(
          "This answer was recently exposed. It is saved as practice, and the original card remains due.",
        );
        const s = await db.sessions.get(session.id);
        await updateSession(db, session.id, {
          excluded: [...(s?.excluded ?? []), item.card.id],
        });
        await load();
        return;
      }
      const event = await saveReview(db, {
        card: item.card,
        state: item.state,
        session,
        rating,
        qualification: {
          original: true,
          attempted: attemptedRef.current,
          assisted: false,
          contaminated,
          confirmedFailure: rating === "again",
        },
        durationMs: Math.max(1000, activeMs.current),
        contentVersion: item.note.version,
        eventId: eventId.current,
      });
      setLastEvent(event.id);
      setLastCard(item.card.id);
      await load();
      const updated = await db.sessions.get(session.id);
      if (prefs.adaptive && features.adaptive && updated) {
        const queue = await eligibleCards(db, updated);
        {
          const notes = await db.notes.toArray();
          const recentExposures = await db.exposures
            .where("at")
            .above(
              new Date(
                Math.min(
                  Date.parse(updated.startedAt),
                  Date.now() - 30 * 60000,
                ),
              ).toISOString(),
            )
            .toArray();
          const exposed = new Set(recentExposures.map((e) => e.noteId));
          exposed.add(item.note.id);
          const candidates = await db.activities.toArray();
          const candidate = selectActivity({
            session: updated,
            notes,
            activities: candidates,
            exposedNoteIds: exposed,
            overdue: queue.filter((q) => q.state.memory.reps > 0).length,
            learningDue: queue.some(
              (q) => q.state.memory.state === 1 || q.state.memory.state === 3,
            ),
            reviews: await db.reviews.toArray(),
            attempts: await db.attempts.toArray(),
            at: now(),
          });
          if (candidate) {
            const entry = await openIntervention(
              db,
              updated.id,
              candidate.activity,
              candidate.reason,
            );
            activeMs.current = 0;
            setElapsed(0);
            setIntervention(entry);
            setActivity(candidate.activity);
          }
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!lastEvent || locked.current) return;
    locked.current = true;
    try {
      await undoReview(db, lastEvent);
      await load(lastCard ?? undefined);
      setLastEvent(null);
      setFinished(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
    }
  };
  const report = async () => {
    if (!item || !session) return;
    await reportContent(db, {
      id: id(),
      cardId: item.card.id,
      category: "broken_or_ambiguous",
      comment: "Reported during review.",
      at: now(),
      status: "open",
    });
    await skip();
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(e.target.tagName))
      )
        return;
      if (activity || finished) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!revealed) void expose();
      } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void rate(ratings[Number(e.key) - 1]);
      } else if (e.key.toLowerCase() === "z" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const submitAdaptive = async () => {
    if (!activity || !session || !intervention || busy || locked.current)
      return;
    locked.current = true;
    setBusy(true);
    try {
      const attempt = await saveAdaptiveAttempt(
        db,
        session.id,
        intervention.id,
        adaptiveAnswer,
        activeMs.current,
      );
      setAdaptiveResult(attempt);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const clearActivity = async () => {
    if (locked.current) return;
    locked.current = true;
    try {
      if (intervention && session)
        await checkpointIntervention(
          db,
          session.id,
          intervention.id,
          activeMs.current,
          adaptiveResult ? "completed" : "dismissed",
        );
      setActivity(null);
      setIntervention(null);
      setAdaptiveAnswer("");
      setAdaptiveResult(null);
      activeMs.current = 0;
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      locked.current = false;
    }
  };
  const requestHelp = async () => {
    if (!item || !session || locked.current) return;
    locked.current = true;
    try {
      const candidate = selectActivity({
        session,
        notes: await db.notes.toArray(),
        activities: await db.activities.toArray(),
        reviews: [],
        attempts: [],
        exposedNoteIds: new Set(),
        overdue: 0,
        learningDue: false,
        at: now(),
        requestedNoteId: item.note.id,
      });
      if (candidate) {
        const entry = await openIntervention(
          db,
          session.id,
          candidate.activity,
          candidate.reason,
          true,
        );
        activeMs.current = 0;
        setElapsed(0);
        setIntervention(entry);
        setActivity(candidate.activity);
      } else {
        await recordExposure(db, item.card, session.id, "source");
        setRevealed(true);
        setAttempted(false);
        attemptedRef.current = false;
        setHelpNotice(
          "No reviewed explanation is available for this source. Read the original answer below, edit or report the card if needed, and return to review. This is an exposure, not a recall success.",
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      locked.current = false;
    }
  };
  const intervals = item ? preview(item.state, now()) : null;
  const budgetReached =
    !!session &&
    session.budgetMinutes > 0 &&
    session.activeMs + session.interventionMs >= session.budgetMinutes * 60000;
  return (
    <div className="study-shell">
      <header className="study-header">
        <Link href="/" className="text-link">
          <ArrowLeft size={18} />
          Back to Today
        </Link>
        <span className="study-brand">
          <BookOpen size={20} />
          recall.
        </span>
        <span className="save-state">
          <span className="status-dot" />
          {syncStatus}
        </span>
      </header>
      <main className="study-main">
        {error && <Notice error>{error}</Notice>}
        {!loaded && !error ? (
          <Busy text="Opening your session…" />
        ) : finished || (!item && !activity) ? (
          <section className="session-end">
            <span className="end-icon">
              <Check size={30} />
            </span>
            <p className="eyebrow">A GOOD PLACE TO PAUSE</p>
            <h1>{finished ? "Session finished." : "You’re done for now."}</h1>
            <p>Your progress is saved on this device.</p>
            <div className="end-stats">
              <div>
                <strong>{session?.reviews ?? 0}</strong>
                <span>original reviews</span>
              </div>
              <div>
                <strong>
                  {Math.round(
                    ((session?.activeMs ?? 0) +
                      (session?.interventionMs ?? 0)) /
                      60000,
                  )}
                </strong>
                <span>active minutes</span>
              </div>
              <div>
                <strong>{session?.checks ?? 0}</strong>
                <span>checks offered</span>
              </div>
            </div>
            <RemainingDue />
            <p className="muted">
              Learning steps that are not due yet will appear when it is time.
              Finishing never clears unfinished work.
            </p>
            <div className="inline">
              <Link href="/" className="button primary">
                Back to Today
                <ArrowRight size={16} />
              </Link>
              {lastEvent && (
                <button className="button secondary" onClick={undo}>
                  Undo last review
                </button>
              )}
            </div>
          </section>
        ) : activity ? (
          <section className="study-card">
            <p className="eyebrow">
              OPTIONAL · {activity.cognitiveTask.toUpperCase()}
            </p>
            <h2>{activity.stem}</h2>
            <p className="muted">
              {intervention?.reason} Suggested time: {activity.expectedSeconds}{" "}
              seconds. You can stop at any time.
            </p>
            {elapsed >= activity.expectedSeconds * 1000 && (
              <Notice>
                You have reached the suggested time. Continue if useful, or
                return to review; response speed does not affect your grade.
              </Notice>
            )}
            <button className="text-button" onClick={clearActivity}>
              Return to ordinary review
            </button>
            {!adaptiveResult ? (
              <>
                {activity.options ? (
                  <div className="answer-options">
                    {activity.options.map((o) => (
                      <label key={o.id}>
                        <input
                          type="radio"
                          name="adaptive"
                          value={o.id}
                          checked={adaptiveAnswer === o.id}
                          onChange={() => setAdaptiveAnswer(o.id)}
                        />
                        {o.text}
                      </label>
                    ))}
                  </div>
                ) : (
                  <label>
                    Your answer
                    <textarea
                      value={adaptiveAnswer}
                      onChange={(e) => setAdaptiveAnswer(e.target.value)}
                    />
                  </label>
                )}
                <button
                  className="button primary"
                  disabled={!adaptiveAnswer.trim() || busy}
                  onClick={submitAdaptive}
                >
                  Check my answer
                </button>
                <button className="text-button" onClick={clearActivity}>
                  Skip this check
                </button>
              </>
            ) : (
              <>
                <Notice>
                  {adaptiveResult.grade.replaceAll("_", " ")} ·{" "}
                  {adaptiveResult.feedback}
                </Notice>
                <p>{activity.rationale}</p>
                <AttemptFeedback attempt={adaptiveResult} />
                {activity.rubric && (
                  <ul>
                    {activity.rubric.map((r) => (
                      <li key={r.id}>
                        {r.criterion}
                        {r.essential ? " (essential)" : ""}
                      </li>
                    ))}
                  </ul>
                )}
                <details>
                  <summary>Source support</summary>
                  {activity.sources.map((s, i) => (
                    <blockquote key={i}>{s.quote}</blockquote>
                  ))}
                </details>
                <button className="button primary" onClick={clearActivity}>
                  Continue review
                </button>
                <button
                  className="text-button"
                  onClick={async () => {
                    const updated = {
                      ...adaptiveResult,
                      dispute: "Learner requested a self-check.",
                    };
                    await db.transaction(
                      "rw",
                      db.attempts,
                      db.outbox,
                      async () => {
                        await db.attempts.put(updated);
                        await enqueue(db, "attempts", updated.id, updated);
                      },
                    );
                    setAdaptiveResult(updated);
                  }}
                >
                  Dispute grade
                </button>
                <button
                  className="text-button"
                  onClick={async () => {
                    await reportContent(db, {
                      id: id(),
                      activityId: activity.id,
                      category: "possible_medical_error",
                      comment: "Reported during practice",
                      at: now(),
                      status: "open",
                    });
                    clearActivity();
                  }}
                >
                  Report question
                </button>
              </>
            )}
          </section>
        ) : (
          item && (
            <>
              {helpNotice && <Notice>{helpNotice}</Notice>}
              {features.adaptive && (
                <button
                  className="text-button"
                  onClick={requestHelp}
                  disabled={busy}
                >
                  I don’t understand · optional deeper study
                </button>
              )}
              {budgetReached && (
                <Notice>
                  Your planned time is complete.{" "}
                  <button className="text-button" onClick={end}>
                    Finish now
                  </button>{" "}
                  or continue at your own pace.
                </Notice>
              )}
              <div className="study-meta">
                <span className="pill">RECALL</span>
                <span>
                  {session?.reviews ?? 0} reviewed
                  {session?.budgetMinutes
                    ? ` · ${session.budgetMinutes} minute session`
                    : ""}
                </span>
              </div>
              <section className="study-card" key={item.card.id}>
                <div className="card-source">
                  <span>
                    {item.type.name.includes("AnKing")
                      ? "AnKing"
                      : item.type.name}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Report and skip this card"
                    onClick={report}
                  >
                    <Flag size={17} />
                  </button>
                </div>
                <CardContent
                  card={item.card}
                  note={item.note}
                  type={item.type}
                  revealed={revealed}
                  count={count}
                />
                {!revealed && (
                  <details className="scratchpad">
                    <summary>Write your answer (optional)</summary>
                    <textarea
                      aria-label="Your recalled answer"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      placeholder="A word, a sentence, or just think it through."
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void expose();
                        }
                      }}
                    />
                  </details>
                )}
                {revealed && typed && (
                  <div className="your-answer">
                    <small>YOUR ANSWER</small>
                    <p>{typed}</p>
                  </div>
                )}
                {revealed && sourceOpen && (
                  <div className="source-note">
                    <p>
                      Use the original answer and expanded source fields above
                      to check the gap. No reviewed explanation is available for
                      this card yet.
                    </p>
                    <Link href={`/browse?card=${item.card.id}`}>
                      Edit or inspect this card
                    </Link>
                  </div>
                )}
              </section>
              <div className="review-actions">
                {!revealed ? (
                  <>
                    <button
                      className="button primary reveal"
                      onClick={() => expose()}
                      disabled={busy}
                    >
                      {count ? "Reveal next deletion" : "Show answer"}
                      <kbd>Space</kbd>
                    </button>
                    <div className="pre-reveal-actions">
                      <button
                        className="text-button"
                        onClick={() => expose(true)}
                      >
                        I can’t attempt this yet
                      </button>
                      <button className="text-button" onClick={() => skip()}>
                        <SkipForward size={14} />
                        Skip
                      </button>
                    </div>
                  </>
                ) : !attempted ? (
                  <>
                    <Notice>
                      Saved as an exposure. This card’s schedule is unchanged.
                    </Notice>
                    <button
                      className="button primary reveal"
                      onClick={() => skip()}
                    >
                      Continue
                      <ArrowRight size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <p className="rating-question">How did recall feel?</p>
                    <div className="rating-grid">
                      {ratings.map((r, i) => (
                        <button
                          key={r}
                          className={`rating ${r}`}
                          onClick={() => rate(r)}
                          disabled={busy}
                        >
                          <span>
                            {r[0].toUpperCase() + r.slice(1)}
                            <kbd>{i + 1}</kbd>
                          </span>
                          <small>
                            {intervals && intervalLabel(intervals[r], now())}
                          </small>
                        </button>
                      ))}
                    </div>
                    <p className="rating-help">
                      Again = forgot · Hard = correct, with difficulty
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setSourceOpen((v) => !v)}
                    >
                      I don’t understand
                    </button>
                  </>
                )}
              </div>
              <div className="study-bottom">
                <button
                  className="text-button"
                  onClick={undo}
                  disabled={!lastEvent || busy}
                >
                  <Undo2 size={15} />
                  Undo<kbd>Z</kbd>
                </button>
                <button className="text-button" onClick={end}>
                  <Clock3 size={15} />
                  Finish session
                </button>
              </div>
            </>
          )
        )}
      </main>
    </div>
  );
}
function RemainingDue() {
  const { db } = useLibrary();
  const tick = useClock();
  const remaining = useLiveQuery(() => eligibleCards(db), [db, tick]);
  return (
    <p>
      <strong>{remaining?.length ?? 0} cards remain available now.</strong>
    </p>
  );
}
