"use client";
import { useEffect, useState } from "react";
import type { Attempt } from "@recall/domain";
import { errorMessage } from "@recall/domain";
import { useLibrary } from "./LibraryProvider";
import { enqueue } from "../lib/db/local";
import { Notice } from "./ui";

/** Model/self-check feedback is an annotation, never a scheduler write. */
export default function AttemptFeedback({ attempt }: { attempt: Attempt }) {
  const { db, user, prefs, sync, features } = useLibrary();
  const [job, setJob] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
      setMessage("Feedback queued. You can continue reviewing.");
    } catch (error) {
      setError(errorMessage(error));
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!job) return;
    const timer = setInterval(async () => {
      try {
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
      {user && prefs.aiConsent && features.generation && (
        <button className="text-button" disabled={busy} onClick={request}>
          {busy ? "Checking feedback…" : "Request rubric feedback"}
        </button>
      )}
    </div>
  );
}
