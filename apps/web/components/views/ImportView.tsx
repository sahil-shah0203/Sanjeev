"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { mergeImport } from "../../features/merge";
import Link from "next/link";
import { Upload, FileArchive, CheckCircle2, ArrowRight, X } from "lucide-react";
import { id, type ImportBundle, errorMessage } from "@recall/domain";
import { useLibrary } from "../LibraryProvider";
import { planHistory } from "@recall/scheduler";
import { commitImport } from "../../lib/db/local";
import { PageTitle, Notice, Busy } from "../ui";
import CardContent from "../CardContent";
export default function ImportView() {
  const { db, prefs } = useLibrary();
  const [bundle, setBundle] = useState<ImportBundle | null>(null);
  const [progress, setProgress] = useState<{
    phase: string;
    current: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [historyMode, setHistoryMode] = useState<"fresh" | "replay">("fresh");
  const [ownsHistory, setOwnsHistory] = useState(false);
  const [resumeSuspended, setResumeSuspended] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [mergeMessage, setMergeMessage] = useState("");
  const collections =
    useLiveQuery(
      () => db.imports.filter((r) => r.status === "completed").toArray(),
      [db],
    ) ?? [];
  const worker = useRef<Worker | null>(null);
  const staging = useRef<string>("");
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      worker.current?.terminate();
      clearTimeout(timeout.current);
      if (staging.current)
        void db.media.where("namespace").equals(staging.current).delete();
    },
    [db],
  );
  const cleanup = async () => {
    worker.current?.terminate();
    clearTimeout(timeout.current);
    worker.current = null;
    if (staging.current)
      await db.media.where("namespace").equals(staging.current).delete();
    staging.current = "";
    setBundle(null);
    setProgress(null);
  };
  const inspect = async (file: File) => {
    await cleanup();
    setError("");
    setDone(false);
    setFresh(false);
    setOwnsHistory(false);
    setHistoryMode("fresh");
    setResumeSuspended(false);
    if (!/\.apkg$/i.test(file.name)) {
      setError(
        "Choose an Anki package with the .apkg extension. Native backups can be restored in Settings.",
      );
      return;
    }
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (
        estimate?.quota &&
        estimate.usage &&
        file.size * 3 > estimate.quota - estimate.usage
      )
        throw new Error(
          "There is not enough browser storage. Export a smaller deck or free space before importing.",
        );
      staging.current = id();
      const w = new Worker(
        new URL("../../workers/import.worker.ts", import.meta.url),
      );
      worker.current = w;
      timeout.current = setTimeout(() => {
        void cleanup().then(() =>
          setError(
            "Import exceeded three minutes. Export a smaller selected deck.",
          ),
        );
      }, 180000);
      setProgress({ phase: "Inspecting archive", current: 0, total: 1 });
      w.onmessage = (e) => {
        if (e.data.kind === "progress") setProgress(e.data);
        else if (e.data.kind === "result") {
          clearTimeout(timeout.current);
          setBundle(e.data.bundle);
          setProgress(null);
          w.terminate();
        } else {
          clearTimeout(timeout.current);
          setError(e.data.message);
          setProgress(null);
          w.terminate();
        }
      };
      w.onerror = () => {
        clearTimeout(timeout.current);
        setError(
          "The import worker stopped. Try a smaller selected deck. Your existing library is unchanged.",
        );
        setProgress(null);
        w.terminate();
      };
      w.postMessage({ file, owner: db.owner, namespace: staging.current });
    } catch (e) {
      setError(errorMessage(e));
      setProgress(null);
    }
  };
  const commit = async () => {
    if (!bundle) return;
    setBusy(true);
    try {
      if (target) {
        const result = await mergeImport(db, bundle, target);
        setMergeMessage(
          `${result.added} new cards; ${result.updated} source notes updated; ${result.conflicts} conflicts preserved in Settings. Existing schedules are unchanged.`,
        );
      } else
        await commitImport(
          db,
          resumeSuspended
            ? {
                ...bundle,
                cards: bundle.cards.map((c) => ({ ...c, suspended: false })),
              }
            : bundle,
          historyMode,
        );
      await db.meta.delete(`staging:${staging.current}`);
      staging.current = "";
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const migration = useMemo(
    () => (bundle ? planHistory(bundle, prefs) : null),
    [bundle, prefs.retention, prefs.timezone, prefs.rollover],
  );
  const hasHistory =
    !!bundle &&
    (bundle.report.historyCount > 0 ||
      bundle.cards.some((c) => Number(c.raw.reps) > 0));
  const preview = bundle?.cards.find((c) => c.supported);
  const note = bundle?.notes.find((n) => n.id === preview?.noteId);
  const type = bundle?.types.find((t) => t.id === note?.typeId);
  return (
    <>
      <PageTitle
        eyebrow="BRING YOUR KNOWLEDGE"
        title="Make yourself at home."
        description="Import the cards you already use. Your original content stays on this device."
      />
      {error && <Notice error>{error}</Notice>}
      {done ? (
        <section className="panel import-done">
          <CheckCircle2 size={42} />
          <h2>Your deck is ready.</h2>
          {mergeMessage && <p>{mergeMessage}</p>}
          <p>
            {bundle?.report.ready} playable cards and {bundle?.report.media}{" "}
            media files saved on this device.
          </p>
          <Link href="/" className="button primary">
            Go to Today
            <ArrowRight size={17} />
          </Link>
          <button
            className="text-button"
            onClick={() => {
              setDone(false);
              setBundle(null);
            }}
          >
            Import another deck
          </button>
        </section>
      ) : (
        <>
          {!bundle && !progress && (
            <label
              className="drop-zone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) void inspect(file);
              }}
            >
              <span className="upload-icon">
                <Upload size={32} strokeWidth={1.5} />
              </span>
              <strong>Drop your Anki deck here</strong>
              <span>or click to choose a file</span>
              <input
                aria-label="Choose Anki package"
                type="file"
                accept=".apkg"
                onChange={(e) => {
                  if (e.target.files?.[0]) void inspect(e.target.files[0]);
                }}
              />
              <small>.apkg · up to 512 MiB · processed on your device</small>
            </label>
          )}
          {progress && (
            <section className="panel import-progress">
              <Busy text={progress.phase} />
              <progress value={progress.current} max={progress.total} />
              <p>
                {progress.current} of {progress.total}
              </p>
              <button className="button secondary" onClick={cleanup}>
                <X size={15} />
                Cancel import
              </button>
            </section>
          )}
          {bundle && (
            <>
              <section className="panel import-summary">
                <div className="section-heading">
                  <div className="inline">
                    <FileArchive size={25} />
                    <h2>{bundle.report.filename}</h2>
                  </div>
                  <button className="text-button" onClick={cleanup}>
                    Choose another
                  </button>
                </div>
                <div className="import-counts">
                  {[
                    [bundle.report.ready, "Ready to study"],
                    [bundle.report.cards - bundle.report.ready, "Need support"],
                    [bundle.report.media, "Media files"],
                    [bundle.report.missingMedia.length, "Missing references"],
                  ].map(([value, label]) => (
                    <div key={label}>
                      <strong>{value}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <p>
                  {bundle.report.notes} notes · {bundle.report.cards} imported
                  card identities · {bundle.report.format}
                </p>
                {bundle.report.warnings.map((w) => (
                  <Notice key={w}>{w}</Notice>
                ))}
                {bundle.cards
                  .filter((c) => !c.supported)
                  .map((c) => (
                    <p key={c.id}>
                      Card {c.originalId}: {c.reason}
                    </p>
                  ))}
                {collections.length > 0 && (
                  <label>
                    Import destination
                    <select
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Create a separate collection</option>
                      {[
                        ...new Map(
                          collections.map((r) => [r.namespace, r]),
                        ).values(),
                      ].map((r) => (
                        <option key={r.namespace} value={r.namespace}>
                          Update {r.filename}
                        </option>
                      ))}
                    </select>
                    {target && (
                      <small>
                        Match original IDs, note GUIDs, and compatible
                        templates. Existing schedules and locally edited notes
                        are preserved. Media conflicts require a separate
                        collection.
                      </small>
                    )}
                  </label>
                )}
                {!target && bundle.cards.some((c) => c.suspended) && (
                  <Notice>
                    {bundle.cards.filter((c) => c.suspended).length} cards are
                    suspended in this export.
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={resumeSuspended}
                        onChange={(e) => setResumeSuspended(e.target.checked)}
                      />
                      Resume suspended cards on import
                    </label>
                  </Notice>
                )}
                {!target && hasHistory ? (
                  <div className="history-choice">
                    <h3>Choose how to handle progress</h3>
                    <label>
                      Scheduling
                      <select
                        value={historyMode}
                        onChange={(e) =>
                          setHistoryMode(e.target.value as "fresh" | "replay")
                        }
                      >
                        <option value="fresh">
                          Start fresh; preserve original history
                        </option>
                        <option value="replay" disabled={!migration?.supported}>
                          Replay complete history; preserve first due dates
                        </option>
                      </select>
                    </label>
                    {historyMode === "fresh" ? (
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={fresh}
                          onChange={(e) => setFresh(e.target.checked)}
                        />
                        Start these cards fresh in Recall. Keep the original
                        scheduling data and logs in my backup.
                      </label>
                    ) : (
                      <>
                        <p>
                          {migration?.replayedReviews} ratings will reconstruct
                          memory using Recall’s pinned FSRS defaults.{" "}
                          {migration?.preservedDates} first due days remain
                          unchanged in {prefs.timezone}. Future intervals can
                          differ from Anki.
                        </p>
                        <label className="check-row">
                          <input
                            type="checkbox"
                            checked={ownsHistory}
                            onChange={(e) => setOwnsHistory(e.target.checked)}
                          />
                          This is my own progress, and {prefs.timezone} matches
                          the export’s scheduling timezone.
                        </label>
                        <details>
                          <summary>Review due-date comparison</summary>
                          <p>
                            Imported first due dates are preserved; these are
                            the dates a pure replay would otherwise suggest.
                          </p>
                          <ul>
                            {migration?.preview.slice(0, 50).map((p) => (
                              <li key={p.cardId}>
                                Card {p.cardId}: keep {p.sourceDay}; replay
                                would schedule {p.replayedDue.slice(0, 10)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </>
                    )}
                    {!migration?.supported && (
                      <details>
                        <summary>Why history replay is unavailable</summary>
                        {migration?.reasons.slice(0, 20).map((reason) => (
                          <p key={reason}>{reason}</p>
                        ))}
                        <p>
                          Original logs are retained. Export a compatible
                          review-only selection, or explicitly start fresh.
                        </p>
                      </details>
                    )}
                  </div>
                ) : (
                  <Notice>
                    This file has no review history. These cards will start
                    fresh.
                  </Notice>
                )}
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    (!target &&
                      hasHistory &&
                      (historyMode === "fresh"
                        ? !fresh
                        : !ownsHistory || !migration?.supported))
                  }
                  onClick={commit}
                >
                  {busy
                    ? "Saving your library…"
                    : `Import ${bundle.report.cards} cards`}
                  <ArrowRight size={17} />
                </button>
              </section>
              {preview && note && type && (
                <section className="panel preview-panel">
                  <p className="eyebrow">PROMPT PREVIEW</p>
                  <CardContent card={preview} note={note} type={type} />
                  <p className="muted">
                    Answers stay hidden until you reveal them during study.
                  </p>
                </section>
              )}
            </>
          )}
          <div className="import-help">
            <h3>A few things to know</h3>
            <p>
              Basic and supported cloze cards work here, including the supplied
              AnKing pattern. Cards that require unsupported templates are
              preserved and listed for review.
            </p>
            <p>
              Imports stay private. Accounts and cloud recovery are optional.
              Export a native backup in Settings to keep a copy of your
              progress.
            </p>
          </div>
        </>
      )}
    </>
  );
}
