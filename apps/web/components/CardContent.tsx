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
import EnhancedOcclusionImage from "./EnhancedOcclusionImage";
import { isEnhancedOcclusion } from "../../../packages/card-renderer/src/enhanced-occlusion";
import {
  peekCardMedia,
  prepareCardMedia,
  retainCardMedia,
} from "../features/card-media";
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
  const assetKey = assets
    ?.map((asset) => `${asset.namespace}/${asset.name}/${asset.hash}`)
    .join("\n");
  const [assetSnapshot, setAssetSnapshot] = useState<{
    key: string;
    assets: MediaAsset[];
  }>();
  useEffect(() => {
    if (!assets || assetKey === undefined) return;
    setAssetSnapshot((current) =>
      current?.key === assetKey ? current : { key: assetKey, assets },
    );
  }, [assets, assetKey]);
  const stableAssets =
    assetSnapshot && assetSnapshot.key === assetKey
      ? assetSnapshot.assets
      : undefined;
  const [prepared, setPrepared] = useState<
    | {
        key: string;
        urls: Map<string, string>;
      }
    | undefined
  >(() => {
    const media = peekCardMedia(db, note, type);
    return media ? { key: media.signature, urls: media.urls } : undefined;
  });
  const urls = useMemo(
    () => (prepared ? prepared.urls : new Map<string, string>()),
    [prepared],
  );
  const [zoom, setZoom] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    if (stableAssets)
      void prepareCardMedia(db, note, type)
        .then((media) => {
          if (active) setPrepared({ key: media.signature, urls: media.urls });
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [db, note, type, stableAssets, assetKey]);
  useEffect(
    () => (prepared ? retainCardMedia(prepared.urls) : undefined),
    [prepared?.urls],
  );
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
  if (!prepared && names.length)
    return (
      <p className="muted" role="status">
        Preparing card media…
      </p>
    );
  return (
    <>
      <div
        className="card-content"
        onClick={(e) => {
          if (e.target instanceof HTMLImageElement) setZoom(e.target.src);
        }}
        onKeyDown={(e) => {
          if (
            e.target instanceof HTMLImageElement &&
            (e.key === "Enter" || e.key === " ")
          ) {
            e.preventDefault();
            setZoom(e.target.src);
          }
        }}
      >
        <div
          data-testid="card-face"
          dangerouslySetInnerHTML={{ __html: output.html }}
        />
        {type.kind === "occlusion" && (
          <OcclusionImage
            key={`${card.id}:${note.version}:${revealed}`}
            card={card}
            note={note}
            revealed={revealed}
            urls={urls}
          />
        )}{" "}
        {isEnhancedOcclusion(type) && (
          <EnhancedOcclusionImage
            key={`${card.id}:${note.version}:${revealed}`}
            note={note}
            type={type}
            revealed={revealed}
            urls={urls}
            loading={!prepared}
          />
        )}
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
