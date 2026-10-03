"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { renderCard } from "@recall/card-renderer";
import { safeHtml } from "../../../packages/card-renderer/src/sanitize";
import {
  type Note,
  type NoteType,
  type SourceCard,
  type MediaAsset,
} from "@recall/domain";
import { useLibrary } from "./LibraryProvider";
import OcclusionImage from "./OcclusionImage";
export default function CardContent({
  card,
  note,
  type,
  revealed = false,
  count = 0,
  showExtras = true,
}: {
  card: SourceCard;
  note: Note;
  type: NoteType;
  revealed?: boolean;
  count?: number;
  showExtras?: boolean;
}) {
  const { db } = useLibrary();
  const names = useMemo(() => {
    const found = new Set<string>();
    const text = [
      ...note.fields,
      ...type.templates.flatMap((t) => [t.front, t.back]),
    ].join(" ");
    const pattern =
      /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>]+))|\[sound:([^\]]+)\]/gi;
    for (const match of text.matchAll(pattern)) {
      let name = (match[1] ?? match[2] ?? match[3] ?? match[4]).replace(
        /&amp;/g,
        "&",
      );
      try {
        name = decodeURIComponent(name);
      } catch {}
      found.add(name);
    }
    return [...found];
  }, [note, type]);
  const assets = useLiveQuery<MediaAsset[]>(
    () =>
      names.length
        ? db.media
            .where("[namespace+name]")
            .anyOf(names.map((name) => [note.namespace, name]))
            .toArray()
        : Promise.resolve([]),
    [db, note.namespace, names],
  );
  const [urls, setUrls] = useState(new Map<string, string>());
  const [zoom, setZoom] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const map = new Map<string, string>();
    for (const asset of assets ?? [])
      if (
        asset.mime.startsWith("image/") ||
        asset.mime.startsWith("audio/") ||
        asset.mime.startsWith("video/")
      )
        map.set(asset.name, URL.createObjectURL(asset.blob));
    setUrls(map);
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
    };
  }, [assets]);
  useEffect(() => {
    setZoom(null);
  }, [card.id, revealed]);
  useEffect(() => {
    if (zoom) dialog.current?.showModal();
    else dialog.current?.close();
  }, [zoom]);
  const output = useMemo(() => {
    try {
      const raw = renderCard(type, note, card.ord, revealed, count);
      return {
        html: safeHtml(raw.html, urls, window),
        extras: raw.extras.map((e) => ({
          ...e,
          html: safeHtml(e.html, urls, window),
        })),
        error: "",
      };
    } catch (e) {
      return {
        html: "",
        extras: [],
        error: e instanceof Error ? e.message : "Card cannot be displayed.",
      };
    }
  }, [card.ord, note, type, revealed, count, urls]);
  if (output.error)
    return (
      <p role="alert" className="notice error">
        {output.error}
      </p>
    );
  return (
    <>
      <div
        className="card-content"
        onClick={(e) => {
          if (e.target instanceof HTMLImageElement) setZoom(e.target.src);
        }}
      >
        <div
          data-testid="card-face"
          dangerouslySetInnerHTML={{ __html: output.html }}
        />
        {type.kind === "occlusion" && (
          <OcclusionImage
            card={card}
            note={note}
            revealed={revealed}
            urls={urls}
          />
        )}{" "}
        {revealed && showExtras && output.extras.length > 0 && (
          <div className="extras">
            {output.extras.map((e) => (
              <details key={e.name}>
                <summary>{e.name}</summary>
                <div dangerouslySetInnerHTML={{ __html: e.html }} />
              </details>
            ))}
          </div>
        )}
      </div>
      {revealed &&
        type.kind !== "occlusion" &&
        assets?.some((a) => a.mime.startsWith("image/")) && (
          <button
            className="text-button image-open"
            onClick={() => setZoom(urls.values().next().value ?? null)}
          >
            Open image viewer
          </button>
        )}
      <dialog
        ref={dialog}
        className="image-dialog"
        onCancel={() => setZoom(null)}
      >
        <div>
          <button onClick={() => setZoom(null)} className="button secondary">
            Close image viewer
          </button>
        </div>
        {zoom && (
          <div className="zoom-image">
            <img src={zoom} alt="Original card image" />
          </div>
        )}
      </dialog>
    </>
  );
}
