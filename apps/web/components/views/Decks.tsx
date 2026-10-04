"use client";
import { useState } from "react";
import { useClock } from "../../features/useClock";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowRight,
  Download,
  Layers,
  Upload,
  Search,
  HardDrive,
} from "lucide-react";
import { type ImportBundle, errorMessage } from "@recall/domain";
import { ankiContent } from "@recall/exporter";
import { useLibrary } from "../LibraryProvider";
import { eligibleCards } from "../../lib/db/local";
import { download } from "../../features/backup";
import { PageTitle, Empty, Notice } from "../ui";
export default function Decks() {
  const { db } = useLibrary();
  const tick = useClock();
  const router = useRouter();
  const routedPath = usePathname();
  const path =
    typeof window === "undefined" ? routedPath : window.location.pathname;
  const deckId = path.split("/")[2];
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [exportReport, setExportReport] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState("");
  const decks = useLiveQuery(() => db.decks.toArray(), [db]) ?? [];
  const cards = useLiveQuery(() => db.cards.toArray(), [db]) ?? [];
  const eligible = useLiveQuery(() => eligibleCards(db), [db, tick]) ?? [];
  const imports = useLiveQuery(() => db.imports.toArray(), [db]) ?? [];
  const deck = decks.find((d) => d.id === deckId);
  const report = imports.find((i) => i.id === deck?.importId);
  const deckCards = cards.filter((c) => c.deckId === deckId);
  const start = async (d: string) => {
    router.push(`/?deck=${encodeURIComponent(d)}`);
  };
  const exportDeck = async () => {
    if (!deck || !report) return;
    setBusy(true);
    setError("");
    try {
      const notes = await db.notes
        .where("namespace")
        .equals(deck.namespace)
        .toArray();
      const bundle: ImportBundle = {
        report,
        decks: decks.filter((d) => d.namespace === deck.namespace),
        cards: cards.filter((c) => c.namespace === deck.namespace),
        notes,
        types: (await db.types.toArray()).filter((t) =>
          notes.some((n) => n.typeId === t.id),
        ),
        media: await db.media
          .where("namespace")
          .equals(deck.namespace)
          .toArray(),
      };
      const result = await ankiContent(bundle);
      download(result.blob, "recall-content.apkg");
      setExportReport(result.report);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const prepareOffline = async () => {
    setBusy(true);
    try {
      const assets = await db.media
        .where("namespace")
        .equals(deck!.namespace)
        .toArray();
      if (report && assets.length !== report.media)
        throw new Error(
          "Some media is missing locally. Synchronize before preparing this deck offline.",
        );
      if (!("serviceWorker" in navigator))
        throw new Error("This browser does not support offline app caching.");
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration?.active)
        throw new Error(
          "Offline app caching is available in the production build. Run the built app, then try again.",
        );
      await new Promise<void>((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(
          () =>
            reject(
              new Error(
                "Offline shell preparation timed out. Retry while connected.",
              ),
            ),
          30000,
        );
        channel.port1.onmessage = (e) => {
          clearTimeout(timeout);
          channel.port1.close();
          e.data.ok
            ? resolve()
            : reject(
                new Error(
                  "Some app files could not be cached. Retry while connected.",
                ),
              );
        };
        registration.active!.postMessage({ type: "CACHE_SHELL" }, [
          channel.port2,
        ]);
      });
      await navigator.storage.persist();
      setOffline(
        `All ${assets.length} media files are on this device. Keep a native backup because browser storage can be cleared.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        eyebrow={deck ? "YOUR DECK" : "YOUR LIBRARY"}
        title={deck?.name.split("::").at(-1) ?? "Your decks"}
        description={
          deck
            ? "Your source cards, study history, and compatibility in one place."
            : "A home for the material you want to remember."
        }
        action={
          <Link href="/import" className="button primary">
            <Upload size={16} />
            Import deck
          </Link>
        }
      />
      {error && <Notice error>{error}</Notice>}
      {deck ? (
        <>
          <Link href="/decks" className="text-link">
            ← All decks
          </Link>
          <section className="panel deck-detail">
            <div className="import-counts">
              {[
                [deckCards.length, "Total cards"],
                [
                  eligible.filter((x) => x.card.deckId === deck.id).length,
                  "Available now",
                ],
                [deckCards.filter((c) => c.suspended).length, "Suspended"],
                [deckCards.filter((c) => !c.supported).length, "Need support"],
              ].map(([v, l]) => (
                <div key={l}>
                  <strong>{v}</strong>
                  <span>{l}</span>
                </div>
              ))}
            </div>
            <div className="button-row">
              <button className="button primary" onClick={() => start(deck.id)}>
                Study deck
                <ArrowRight size={16} />
              </button>
              <Link
                className="button secondary"
                href={`/browse?deck=${deck.id}`}
              >
                Browse cards
              </Link>
              <button
                className="button secondary"
                onClick={prepareOffline}
                disabled={busy}
              >
                <HardDrive size={16} />
                Check offline readiness
              </button>
              <button
                className="button secondary"
                onClick={exportDeck}
                disabled={busy}
              >
                <Download size={16} />
                Export content to Anki
              </button>
            </div>
            {offline && <Notice>{offline}</Notice>}
            {exportReport.map((x) => (
              <Notice key={x}>{x}</Notice>
            ))}
          </section>
          <section className="panel">
            <h2>Import & compatibility</h2>
            <p>
              {report?.filename} · {report?.format}
            </p>
            <p>
              {report?.ready} ready ·{" "}
              {(report?.cards ?? 0) - (report?.ready ?? 0)} need support ·{" "}
              {report?.media} media files
            </p>
            <p className="muted">
              Scheduling:{" "}
              {report?.historyMode === "fresh"
                ? "started fresh; original raw data retained"
                : report?.historyMode === "replay"
                  ? "history replayed; first due dates preserved; future intervals may differ from Anki"
                  : "due-only migration, memory estimates uncertain"}
              .
            </p>
            {report?.warnings.map((w) => (
              <Notice key={w}>{w}</Notice>
            ))}
            {report?.missingMedia.length !== 0 && (
              <p>Missing: {report?.missingMedia.join(", ")}</p>
            )}
            {deckCards
              .filter((c) => !c.supported)
              .map((c) => (
                <p key={c.id}>
                  Card {c.originalId}: {c.reason}
                </p>
              ))}
          </section>
        </>
      ) : (
        <>
          <label className="search-input">
            <Search size={18} />
            <input
              aria-label="Find a deck"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a deck…"
            />
          </label>
          {decks.length ? (
            <div className="deck-list">
              {decks
                .filter((d) =>
                  d.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((d) => (
                  <Link
                    className="deck-list-row"
                    key={d.id}
                    href={`/decks/${d.id}`}
                  >
                    <span className="deck-icon">
                      <Layers size={23} />
                    </span>
                    <div>
                      <h3>{d.name.replaceAll("::", " / ")}</h3>
                      <span>
                        {cards.filter((c) => c.deckId === d.id).length} cards ·
                        stored on this device
                      </span>
                    </div>
                    <span className="due-badge">
                      {eligible.filter((x) => x.card.deckId === d.id).length}{" "}
                      available
                    </span>
                    <ArrowRight size={18} />
                  </Link>
                ))}
            </div>
          ) : (
            <Empty
              icon={<Layers />}
              title="Your library is waiting."
              action={
                <Link href="/import" className="button primary">
                  Import your first deck
                </Link>
              }
            >
              Choose an Anki package to start with the material you already
              have.
            </Empty>
          )}
        </>
      )}
    </>
  );
}
