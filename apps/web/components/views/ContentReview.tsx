"use client";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ActivitySchema,
  errorMessage,
  id,
  type ContentReport,
  type Activity,
  type Note,
} from "@recall/domain";
import { stripHtml } from "@recall/card-renderer";
import { useLibrary } from "../LibraryProvider";
import { PageTitle, Notice, Busy } from "../ui";
import { savePreferences } from "../../lib/db/local";
export default function ContentReview() {
  const { db, user, prefs, sync } = useLibrary();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState(user?.id ?? "");
  const [queue, setQueue] = useState<Activity[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [source, setSource] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [json, setJson] = useState("");
  const [comment, setComment] = useState("");
  const [checked, setChecked] = useState(false);
  const [noteId, setNoteId] = useState("");
  const [task, setTask] = useState<Activity["cognitiveTask"]>("recall");
  const [format, setFormat] = useState<Activity["format"]>("short_answer");
  const [job, setJob] = useState<string | null>(null);
  const notes = useLiveQuery(() => db.notes.toArray(), [db]) ?? [];
  const load = async () => {
    setError("");
    try {
      const r = await fetch(
        `/api/review-content?owner=${encodeURIComponent(owner || user?.id || "")}`,
      );
      const b = await r.json();
      if (!r.ok) throw new Error(b.error.message);
      setQueue(b.activities);
      setReports(b.reports ?? []);
      setSource(b.notes);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    if (!job) return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/jobs/${job}`);
        const b = await r.json();
        if (!r.ok) throw new Error(b.error.message);
        setMessage(
          `Generation ${b.status.replaceAll("_", " ")}${b.output?.abstain ? `: ${b.output.abstain}` : ""}`,
        );
        if (["succeeded", "failed", "cancelled"].includes(b.status)) {
          setJob(null);
          setBusy(false);
          await sync();
          void load();
        }
      } catch (e) {
        setError(errorMessage(e));
        setJob(null);
        setBusy(false);
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [job]);
  const author = () => {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    const draft: Activity = {
      id: id(),
      version: id(),
      objective: "Describe the supported objective",
      format,
      cognitiveTask: task,
      stem: "Write the source-supported prompt",
      acceptedAnswers: [],
      rationale: "",
      sources: [
        {
          noteId: note.id,
          version: note.version,
          field: 0,
          quote: stripHtml(note.fields[0]).slice(0, 1200),
        },
      ],
      expectedSeconds: 30,
      status: "draft",
      modelVersion: null,
      promptVersion: "human-authored-1",
      validatorVersion: "source-validator-1",
    };
    setSource([note]);
    setSelected(draft);
    setJson(JSON.stringify(draft, null, 2));
    setChecked(false);
  };
  const resolveReport = async (report: ContentReport) => {
    setBusy(true);
    try {
      const response = await fetch("/api/review-content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: owner || user?.id,
          reportId: report.id,
          comment,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error?.message ?? "Report resolution failed.");
      await load();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    setBusy(true);
    setError("");
    try {
      await sync();
      const r = await fetch("/api/generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId, task, format }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error.message);
      setJob(b.id);
      setMessage(
        "Generation queued. You can continue ordinary study while the worker runs.",
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  const decide = async (action: string) => {
    setBusy(true);
    setError("");
    try {
      const activity = ActivitySchema.parse(JSON.parse(json));
      const r = await fetch("/api/review-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: owner || user?.id,
          action,
          activity,
          comment,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error.message);
      setMessage(
        `Activity ${action === "approve" ? "approved" : action === "draft" ? "saved as draft" : action === "reject" ? "rejected" : "quarantined"}.`,
      );
      setSelected(null);
      setChecked(false);
      await load();
      await sync();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="SOURCE-GROUNDED PRACTICE"
        title="Review before release."
        description="Review broader authored content and resolve reports. Source exercises remain explicitly unverified."
      />
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {!user ? (
        <Notice>
          Sign in to request generation or access an assigned content-review
          scope. Ordinary review is available without an account.
        </Notice>
      ) : (
        <>
          <section className="panel">
            <h2>Request one draft</h2>
            <label className="check-row">
              <input
                type="checkbox"
                checked={prefs.aiConsent}
                onChange={async (e) => {
                  try {
                    await savePreferences(db, {
                      ...prefs,
                      aiConsent: e.target.checked,
                    });
                  } catch (error) {
                    setError(errorMessage(error));
                  }
                }}
              />
              Allow selected source excerpts to be processed for reviewer drafts
              and rubric feedback
            </label>
            <p>
              Only the selected source note is processed. Insufficient support
              returns an abstention.
            </p>
            <div className="browse-toolbar">
              <select
                value={noteId}
                aria-label="Source note"
                onChange={(e) => setNoteId(e.target.value)}
              >
                <option value="">Choose a source note</option>
                {notes.slice(0, 500).map((n) => (
                  <option key={n.id} value={n.id}>
                    {stripHtml(n.fields[0]).slice(0, 100)}
                  </option>
                ))}
              </select>
              <select
                value={task}
                aria-label="Cognitive task"
                onChange={(e) =>
                  setTask(e.target.value as Activity["cognitiveTask"])
                }
              >
                {["recall", "explain", "discriminate", "apply"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                aria-label="Question format"
                value={format}
                onChange={(e) =>
                  setFormat(e.target.value as Activity["format"])
                }
              >
                <option value="short_answer">Short answer</option>
                <option value="multiple_choice">Multiple choice</option>
                <option value="brief_explanation">
                  One-sentence explanation
                </option>
              </select>
              <button
                className="button primary"
                disabled={busy || !noteId || !prefs.aiConsent}
                onClick={generate}
              >
                Request draft
              </button>
              <button
                className="button secondary"
                disabled={busy || !noteId}
                onClick={author}
              >
                Write a draft
              </button>
            </div>
            {!prefs.aiConsent && (
              <p className="muted">
                Selected-source AI processing must first be enabled in Settings.
              </p>
            )}
            {job && (
              <button
                className="text-button"
                onClick={async () => {
                  await fetch(`/api/jobs/${job}`, { method: "DELETE" });
                  setMessage("Cancellation requested.");
                }}
              >
                Cancel job
              </button>
            )}
          </section>
          <section className="panel">
            <h2>Assigned review queue</h2>
            <label>
              Collection owner ID
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder={user.id}
              />
            </label>
            <button className="button secondary" onClick={load}>
              Load assigned queue
            </button>
            <p className="muted">
              Access is checked on the server against reviewer assignments.
            </p>
            <div className="deck-list">
              {queue.map((a) => (
                <button
                  key={a.id}
                  className="deck-list-row"
                  onClick={() => {
                    setSelected(a);
                    setJson(JSON.stringify(a, null, 2));
                    setChecked(false);
                  }}
                >
                  <div>
                    <h3>{a.stem}</h3>
                    <span>
                      {a.status} · {a.cognitiveTask} ·{" "}
                      {a.modelVersion ?? "Authored"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
          {reports.length > 0 && (
            <section className="panel">
              <h2>Content reports</h2>
              <label>
                Resolution notes
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </label>
              {reports.map((report) => (
                <div className="review-source" key={report.id}>
                  <p>
                    {report.category} · {report.status}
                  </p>
                  <p>{report.comment}</p>
                  <small>
                    {report.activityId
                      ? `Activity ${report.activityId}`
                      : `Card ${report.cardId}`}
                  </small>
                  {report.status === "open" && (
                    <button
                      className="button secondary"
                      disabled={busy || comment.trim().length < 3}
                      onClick={() => resolveReport(report)}
                    >
                      Record resolution
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}
          {selected && (
            <section className="panel">
              <h2>Candidate and supporting source</h2>
              {selected.sources.map((ref, i) => {
                const n = source.find((n) => n.id === ref.noteId);
                return (
                  <div key={i} className="review-source">
                    <strong>
                      Note {ref.noteId} · field {ref.field} · version{" "}
                      {ref.version.slice(0, 12)}
                    </strong>
                    <p>
                      {n
                        ? stripHtml(n.fields[ref.field])
                        : "Source not available"}
                    </p>
                    <p>Quoted support: {ref.quote}</p>
                  </div>
                );
              })}
              <label>
                Editable draft JSON
                <textarea
                  className="review-json"
                  value={json}
                  onChange={(e) => {
                    setJson(e.target.value);
                    setChecked(false);
                  }}
                />
              </label>
              <label>
                Review notes
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Document scope, accuracy, ambiguity, or required revisions."
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                I checked source fidelity, medical correctness/currentness, a
                defensible answer, and distractor rationales.
              </label>
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={!checked || busy}
                  onClick={() => decide("approve")}
                >
                  Approve this version
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => decide("draft")}
                >
                  Save draft
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => decide("reject")}
                >
                  Reject
                </button>
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => decide("quarantine")}
                >
                  Quarantine
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
