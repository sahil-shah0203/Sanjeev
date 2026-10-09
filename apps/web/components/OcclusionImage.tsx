"use client";
import { useEffect, useRef, useState } from "react";
import {
  occlusionShapes,
  visibleMasks,
} from "../../../packages/card-renderer/src/occlusion";
import type { Note, SourceCard } from "@recall/domain";
export default function OcclusionImage({
  card,
  note,
  revealed,
  urls,
}: {
  card: SourceCard;
  note: Note;
  revealed: boolean;
  urls: Map<string, string>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(false);
  const decoded = useRef<
    { url: string; image: Promise<HTMLImageElement> } | undefined
  >(undefined);
  const [paintedAnswer, setPaintedAnswer] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError("");
    const run = async () => {
      const match = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(
        note.fields[1] ?? "",
      );
      if (!match)
        throw new Error("The image-occlusion source image is missing.");
      let name = match[1].replace(/&amp;/g, "&");
      try {
        name = decodeURIComponent(name);
      } catch {}
      const url = urls.get(name);
      if (!url) {
        if (urls.size) throw new Error("The mask image is not available.");
        return;
      }
      const shapes = occlusionShapes(note.fields[0], card.ord + 1);
      if (decoded.current?.url !== url) {
        const image = (async () => {
          const img = new Image();
          img.src = url;
          await img.decode();
          return img;
        })();
        decoded.current = { url, image };
        void image.catch(() => {
          if (decoded.current?.url === url) decoded.current = undefined;
        });
      }
      const img = await decoded.current!.image;
      if (cancelled || !canvas.current) return;
      if (img.naturalWidth * img.naturalHeight > 40000000)
        throw new Error("This image is too large for the mask renderer.");
      const buffer = document.createElement("canvas");
      buffer.width = img.naturalWidth;
      buffer.height = img.naturalHeight;
      const ctx = buffer.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available.");
      ctx.drawImage(img, 0, 0);
      for (const mask of visibleMasks(shapes, card.ord + 1, revealed)) {
        ctx.fillStyle = mask.ordinal === card.ord + 1 ? "#e59e8f" : "#efdb98";
        ctx.beginPath();
        if (mask.kind === "rect")
          ctx.rect(
            mask.left * buffer.width,
            mask.top * buffer.height,
            mask.width * buffer.width,
            mask.height * buffer.height,
          );
        else if (mask.kind === "ellipse")
          ctx.ellipse(
            (mask.left + mask.width / 2) * buffer.width,
            (mask.top + mask.height / 2) * buffer.height,
            (mask.width * buffer.width) / 2,
            (mask.height * buffer.height) / 2,
            0,
            0,
            Math.PI * 2,
          );
        else {
          mask.points!.forEach((p, i) =>
            i
              ? ctx.lineTo(p.x * buffer.width, p.y * buffer.height)
              : ctx.moveTo(p.x * buffer.width, p.y * buffer.height),
          );
          ctx.closePath();
        }
        ctx.fill();
      }
      const output = canvas.current;
      output.width = buffer.width;
      output.height = buffer.height;
      output.getContext("2d")!.drawImage(buffer, 0, 0);
      setPaintedAnswer(revealed);
      setReady(true);
    };
    void run().catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
    };
  }, [card.ord, note, revealed, urls]);
  return (
    <div>
      {error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : (
        <>
          {!ready && <p className="muted">Preparing masked image…</p>}
          <div
            style={{ overflow: "auto", maxHeight: zoom ? "70vh" : undefined }}
          >
            <canvas
              ref={canvas}
              role="img"
              aria-label={
                paintedAnswer
                  ? "Image with the requested mask revealed"
                  : "Image occlusion prompt. Recall the label under the highlighted region."
              }
              style={{
                display: ready ? "block" : "none",
                maxWidth: zoom ? "none" : "100%",
                height: "auto",
              }}
            />
          </div>
          {ready && (
            <button className="text-button" onClick={() => setZoom((v) => !v)}>
              {zoom ? "Fit image" : "Zoom masked image"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
