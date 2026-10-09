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
import { looksLikeSvg, safeSvg } from "../../../packages/card-renderer/src/svg";
import { recoverCardMedia } from "../features/media-recovery";
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
  const { db, user } = useLibrary();
  const [recovering, setRecovering] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [retry, setRetry] = useState(0);
  const recoveryAttempt = useRef("");
  const mediaMounted = useRef(false);
  useEffect(() => {
    mediaMounted.current = true;
    return () => {
      mediaMounted.current = false;
    };
  }, []);
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
    ?.map(
      (asset) =>
        `${asset.namespace}/${asset.name}/${asset.hash}/${asset.mime}/${asset.blob?.size ?? -1}`,
    )
    .join("\n");
  useEffect(() => {
    if (!assets || !user || !navigator.onLine || recovering) return;
    const missing = names
      .filter(
        (name) =>
          !assets.some(
            (asset) => asset.name === name && asset.blob?.size === asset.size,
          ),
      )
      .filter((name) => !/^(?:[a-z]+:|\/\/)/i.test(name));
    if (!missing.length) return;
    const key = `${note.namespace}:${missing.join("\n")}:${retry}`;
    if (recoveryAttempt.current === key) return;
    recoveryAttempt.current = key;
    setRecovering(true);
    setMediaError("");
    void recoverCardMedia(db, note.namespace, missing)
      .then((count) => {
        if (mediaMounted.current && !count)
          setMediaError(
            "These images have not finished syncing. Your progress is safe.",
          );
      })
      .catch((error) => {
        if (mediaMounted.current)
          setMediaError(
            error instanceof Error
              ? error.message
              : "Images could not be recovered.",
          );
      })
      .finally(() => {
        if (mediaMounted.current) setRecovering(false);
      });
  }, [db, user?.id, note.namespace, names, assetKey, retry, recovering]);
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
  const [prepared, setPrepared] = useState<{
    key: string;
    urls: Map<string, string>;
  }>();
  const urls = useMemo(
    () =>
      prepared && prepared.key === assetKey
        ? prepared.urls
        : new Map<string, string>(),
    [prepared, assetKey],
  );
  const [zoom, setZoom] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let cancelled = false;
    const map = new Map<string, string>();
    const run = async () => {
      if (!stableAssets || assetKey === undefined) return;
      for (const asset of stableAssets) {
        if (!/^(?:image|audio|video)\//.test(asset.mime)) continue;
        let blob = asset.blob;
        if (!blob || typeof blob.slice !== "function") continue;
        // Validate again at display time, including media restored or synced
        // from another client. Only a rebuilt, resource-free SVG becomes a URL.
        if (
          asset.mime === "image/svg+xml" ||
          /\.svg$/i.test(asset.name) ||
          looksLikeSvg(new Uint8Array(await blob.slice(0, 4096).arrayBuffer()))
        ) {
          try {
            if (blob.size > 1024 * 1024) continue;
            blob = new Blob([safeSvg(await blob.text())], {
              type: "image/svg+xml",
            });
          } catch {
            continue;
          }
        }
        if (cancelled) return;
        map.set(asset.name, URL.createObjectURL(blob));
      }
      if (!cancelled) setPrepared({ key: assetKey, urls: map });
    };
    void run();
    return () => {
      cancelled = true;
      for (const url of map.values()) URL.revokeObjectURL(url);
    };
  }, [stableAssets, assetKey]);
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
  if (
    names.length &&
    (assets === undefined || recovering || prepared?.key !== assetKey)
  )
    return (
      <p className="muted" role="status">
        {recovering ? "Recovering card images…" : "Preparing card media…"}
      </p>
    );
  return (
    <>
      {mediaError && (
        <p role="status" className="notice">
          {mediaError}{" "}
          <button
            className="text-button"
            onClick={() => {
              recoveryAttempt.current = "";
              setRetry((value) => value + 1);
            }}
          >
            Retry images
          </button>
        </p>
      )}
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
            key={`${card.id}:${note.version}`}
            card={card}
            note={note}
            revealed={revealed}
            urls={urls}
          />
        )}{" "}
        {isEnhancedOcclusion(type) && (
          <EnhancedOcclusionImage
            key={`${card.id}:${note.version}`}
            note={note}
            type={type}
            revealed={revealed}
            urls={urls}
            loading={!stableAssets || prepared?.key !== assetKey}
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
