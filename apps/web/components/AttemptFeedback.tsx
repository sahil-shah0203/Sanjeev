"use client";
import { useEffect, useState, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Attempt } from "@recall/domain";
import { errorMessage } from "@recall/domain";
import { useLibrary } from "./LibraryProvider";
import { enqueue } from "../lib/db/local";
import { Notice } from "./ui";

/** Model/self-check feedback is an annotation, never a scheduler write. */
export default function AttemptFeedback({
  attempt,
  sourceOnly = false,
  autoFeedback = false,
}: {
  attempt: Attempt;
  sourceOnly?: boolean;
  autoFeedback?: boolean;
}) {
  const { db, user, prefs, sync, features } = useLibrary();
  const [job, setJob] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requested = useRef(false);
  const deadline = useRef(0);
  const saved = useLiveQuery(
    () => db.attempts.get(attempt.id),
    [db, attempt.id],
  );
  const selfCheck = async (value: string) => {
    try {
      await db.transaction("rw", db.attempts, db.outbox, async () => {
        const current = await db.attempts.get(attempt.id);
        if (!current) throw new Error("The saved answer is unavailable.");
        const updated = { ...current, adjudication: value };
        await db.attempts.put(updated);
        await enqueue(db, "attempts", updated.id, updated);
      });
      setMessage(
        `Self-check recorded: ${value}. The original schedule is unchanged.`,
      );
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  const request = async () => {
    setBusy(true);
    setError("");
    try {
      await sync();
      const response = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: attempt.id }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message ?? "Feedback request failed.");
      setJob(result.id);
      deadline.current = Date.now() + 130000;
      setMessage("Feedback queued. You can continue reviewing.");
    } catch (error) {
      setError(errorMessage(error));
      setBusy(false);
    }
  };
  useEffect(() => {
    if (
      autoFeedback &&
      user &&
      features.deckPractice &&
      !requested.current &&
      !saved?.modelGrade
    ) {
      requested.current = true;
      void request();
    }
  }, [autoFeedback, user, features.deckPractice, saved?.modelGrade]);
  useEffect(() => {
    if (!job) return;
    const timer = setInterval(async () => {
      try {
        if (Date.now() > deadline.current)
          throw new Error(
            "Feedback is still processing. Your answer is saved; continue reviewing and check the source.",
          );
        const response = await fetch(`/api/jobs/${job}`);
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error?.message ?? "Feedback could not be retrieved.",
          );
        if (result.status === "succeeded") {
          const grade = result.output?.grade;
          setMessage(
            grade
              ? `Model feedback (${grade.outcome.replaceAll("_", " ")}): ${grade.feedback} Compare with the source; this does not change your original-card schedule.`
              : "Feedback completed without a grade. Use the self-check.",
          );
          setJob(null);
          setBusy(false);
          await sync();
        } else if (["failed", "cancelled"].includes(result.status)) {
          setMessage(
            "Model feedback is unavailable. Your answer is saved; use the source self-check.",
          );
          setJob(null);
          setBusy(false);
        }
      } catch (error) {
        setError(errorMessage(error));
        setJob(null);
        setBusy(false);
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [job]);
  return (
    <div className="attempt-feedback">
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {!message && saved?.modelGrade && (
        <Notice>
          AI suggestion ({saved.modelGrade.outcome.replaceAll("_", " ")}):{" "}
          {saved.modelGrade.feedback}
        </Notice>
      )}
      {attempt.grade === "uncertain" && (
        <div className="button-row">
          <button
            className="button secondary"
            onClick={() => selfCheck("matches the source")}
          >
            My answer matches the source
          </button>
          <button
            className="button secondary"
            onClick={() => selfCheck("needs more practice")}
          >
            I need more practice
          </button>
        </div>
      )}
      {user &&
        features.generation &&
        (autoFeedback || (!sourceOnly && prefs.aiConsent)) && (
          <button className="text-button" disabled={busy} onClick={request}>
            {busy ? "Checking feedback…" : "Request rubric feedback"}
          </button>
        )}
    </div>
  );
}
