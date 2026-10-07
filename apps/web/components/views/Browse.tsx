"use client";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Search,
  Flag,
  Pause,
  Play,
  Archive,
  Save,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { type SourceCard, errorMessage, now } from "@recall/domain";
import { stripCloze, stripHtml } from "@recall/card-renderer";
import { nextRollover } from "@recall/scheduler";
import { useLibrary } from "../LibraryProvider";
import { editNote, updateCard, recordExposure } from "../../lib/db/local";
import { PageTitle, Notice, Empty } from "../ui";
import CardContent from "../CardContent";
export default function Browse() {
  const { db, prefs } = useLibrary();
  const [query, setQuery] = useState("");
  const [deckFilter, setDeckFilter] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [hits, setHits] = useState<{ ids: string[]; total: number }>({
    ids: [],
    total: 0,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [reveal, setReveal] = useState(false);
  const worker = useRef<Worker | null>(null);
  const request = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const cards = useLiveQuery(() => db.cards.toArray(), [db]);
  const notes = useLiveQuery(() => db.notes.toArray(), [db]);
  const types = useLiveQuery(() => db.types.toArray(), [db]);
  const decks = useLiveQuery(() => db.decks.toArray(), [db]) ?? [];
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setDeckFilter(params.get("deck") ?? "");
    setSelected(params.get("card"));
  }, []);
  useEffect(() => {
    const w = new Worker(
      new URL("../../workers/search.worker.ts", import.meta.url),
    );
    worker.current = w;
    w.onmessage = (e) => {
      if (e.data.requestId === request.current) setHits(e.data);
    };
    return () => w.terminate();
  }, []);
  useEffect(() => {
    if (!cards || !notes || !worker.current) return;
    const map = new Map(notes.map((n) => [n.id, n]));
    worker.current.postMessage({
      kind: "index",
      rows: cards.map((c) => ({
        id: c.id,
        text: map.get(c.noteId)?.fields.join(" ") ?? "",
        tags: map.get(c.noteId)?.tags ?? [],
        deckId: c.deckId,
        status: !c.supported
          ? "unsupported"
          : c.suspended
            ? "suspended"
            : c.flagged
              ? "flagged"
              : "active",
      })),
    });
  }, [cards, notes]);
  useEffect(() => {
    worker.current?.postMessage({
      query,
      deckId: deckFilter,
      status,
      page,
      requestId: ++request.current,
    });
  }, [cards, notes, query, deckFilter, status, page]);
  const card = cards?.find((c) => c.id === selected);
  const note = notes?.find((n) => n.id === card?.noteId);
  const type = types?.find((t) => t.id === note?.typeId);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
    setReveal(false);
    setEditing(false);
  }, [selected]);
  const mutate = async (c: SourceCard, change: Partial<SourceCard>) => {
    try {
      await updateCard(db, c, change);
      setSaved("Changes saved on this device.");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const save = async () => {
    if (!note) return;
    try {
      await editNote(db, note, fields);
      setEditing(false);
      setSaved(
        "Source updated. Review history was preserved. Dependent practice was quarantined.",
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <PageTitle
        eyebrow="LOOK A LITTLE CLOSER"
        title="Your cards, in context."
        description="Find a note, fix a prompt, or give a difficult card some space."
      />
      {error && <Notice error>{error}</Notice>}
      {saved && <Notice>{saved}</Notice>}
      <div className="browse-toolbar">
        <label className="search-input">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search text or tags…"
            aria-label="Search cards"
          />
        </label>
        <select
          aria-label="Filter by deck"
          value={deckFilter}
          onChange={(e) => {
            setDeckFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All decks</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All cards</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="flagged">Flagged</option>
          <option value="unsupported">Needs support</option>
        </select>
      </div>
      <div className="table-summary">
        <span>{hits.total.toLocaleString()} cards</span>
        <span>Showing up to 50 per page</span>
      </div>
      {hits.ids.length ? (
        <div className="browse-table">
          <table>
            <thead>
              <tr>
                <th>Prompt / source text</th>
                <th>Deck</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {hits.ids.map((cardId) => {
                const c = cards?.find((c) => c.id === cardId);
                const n = notes?.find((n) => n.id === c?.noteId);
                if (!c || !n) return null;
                return (
                  <tr key={c.id}>
                    <td>
                      <button
                        className="card-link"
                        onClick={() => setSelected(c.id)}
                      >
                        {stripHtml(stripCloze(n.fields[0] ?? "")).slice(
                          0,
                          145,
                        ) || "Image or audio card"}
                      </button>
                      <div className="tag-line">
                        {n.tags.slice(0, 2).map((t) => (
                          <span key={t}>{t.split("::").at(-1)}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {decks
                        .find((d) => d.id === c.deckId)
                        ?.name.split("::")
                        .at(-1)}
                    </td>
                    <td>
                      <span className="status-chip">
                        {!c.supported
                          ? "Needs support"
                          : c.suspended
                            ? "Suspended"
                            : c.buriedUntil && c.buriedUntil > now()
                              ? "Buried"
                              : c.flagged
                                ? "Flagged"
                                : "Active"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={c.flagged ? "Remove flag" : "Flag card"}
                        onClick={() => mutate(c, { flagged: !c.flagged })}
                      >
                        <Flag
                          size={16}
                          fill={c.flagged ? "currentColor" : "none"}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No cards here yet.">
          Import a deck or try a different search.
        </Empty>
      )}
      <div className="pagination">
        <button
          className="button secondary"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft size={16} />
          Previous
        </button>
        <span>
          Page {page + 1} of {Math.max(1, Math.ceil(hits.total / 50))}
        </span>
        <button
          className="button secondary"
          disabled={(page + 1) * 50 >= hits.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
          <ChevronRight size={16} />
        </button>
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setSelected(null)}
        className="card-dialog"
      >
        <div className="section-heading">
          <h2>{editing ? "Edit source fields" : "Card details"}</h2>
          <button
            className="icon-button"
            aria-label="Close card details"
            onClick={() => setSelected(null)}
          >
            <X />
          </button>
        </div>
        {card && note && type && (
          <>
            {!card.supported && (
              <Notice>
                {card.reason} Source fields remain available below.
              </Notice>
            )}
            {editing ? (
              <div className="field-editor">
                {type.fields.map((f, i) => (
                  <label key={f}>
                    {f}
                    <textarea
                      value={fields[i] ?? ""}
                      onChange={(e) =>
                        setFields((fs) =>
                          fs.map((v, j) => (j === i ? e.target.value : v)),
                        )
                      }
                      rows={i === 0 ? 5 : 3}
                    />
                  </label>
                ))}
                <div className="button-row">
                  <button className="button primary" onClick={save}>
                    <Save size={16} />
                    Save source
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {card.supported ? (
                  <>
                    <CardContent
                      card={card}
                      note={note}
                      type={type}
                      revealed={reveal}
                    />
                    <button
                      className="button secondary"
                      onClick={async () => {
                        try {
                          if (!reveal)
                            await recordExposure(db, card, "browse", "source");
                          setReveal((v) => !v);
                        } catch (e) {
                          setError(errorMessage(e));
                        }
                      }}
                    >
                      {reveal ? "Hide answer" : "Reveal answer"}
                    </button>
                  </>
                ) : (
                  <pre className="source-raw">{note.fields.join("\n\n")}</pre>
                )}
                <div className="button-row">
                  <button
                    className="button secondary"
                    onClick={async () => {
                      try {
                        await recordExposure(db, card, "browse", "source");
                        setFields([...note.fields]);
                        setEditing(true);
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                    }}
                  >
                    Edit source
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => mutate(card, { suspended: !card.suspended })}
                  >
                    {card.suspended ? <Play size={16} /> : <Pause size={16} />}{" "}
                    {card.suspended ? "Resume card" : "Suspend"}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() =>
                      mutate(card, {
                        buriedUntil:
                          card.buriedUntil && card.buriedUntil > now()
                            ? undefined
                            : nextRollover(
                                now(),
                                prefs.timezone,
                                prefs.rollover,
                              ),
                      })
                    }
                  >
                    <Archive size={16} />
                    {card.buriedUntil && card.buriedUntil > now()
                      ? "Unbury"
                      : "Bury until tomorrow"}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => mutate(card, { flagged: !card.flagged })}
                  >
                    <Flag size={16} />
                    {card.flagged ? "Remove flag" : "Flag"}
                  </button>
                </div>
                <details>
                  <summary>Original identifiers & tags</summary>
                  <p>
                    Card {card.originalId} · Note {note.originalId} ·
                    Cloze/template ordinal {card.ord}
                  </p>
                  <p className="break-text">{note.tags.join(" · ")}</p>
                </details>
              </>
            )}
          </>
        )}
      </dialog>
    </>
  );
}
