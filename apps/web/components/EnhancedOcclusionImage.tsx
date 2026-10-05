"use client";
import { useEffect, useRef, useState } from "react";
import type { Note, NoteType } from "@recall/domain";
import { enhancedOcclusion } from "../../../packages/card-renderer/src/enhanced-occlusion";

/** Both layers must decode before anything is displayed, including in zoom. */
export default function EnhancedOcclusionImage({
  note,
  type,
  revealed,
  urls,
  loading,
}: {
  note: Note;
  type: NoteType;
  revealed: boolean;
  urls: Map<string, string>;
  loading: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [hideMasks, setHideMasks] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError("");
    const run = async () => {
      if (loading) return;
      const sources = enhancedOcclusion(type, note);
      const load = async (name: string) => {
        const url = urls.get(name);
        if (!url)
          throw new Error(
            "An image or mask is missing or cannot be safely displayed.",
          );
        const image = new Image();
        image.src = url;
        await image.decode();
        if (
          !image.naturalWidth ||
          image.naturalWidth * image.naturalHeight > 40000000
        )
          throw new Error("The image exceeds the mask renderer's pixel limit.");
        return image;
      };
      const [base, mask] = await Promise.all([
        load(sources.image),
        load(revealed ? sources.answer : sources.question),
      ]);
      if (cancelled || !canvas.current) return;
      // Match the original template's width:100% overlay while preserving the
      // mask's aspect ratio; stretching its height could uncover source labels.
      const buffer = document.createElement("canvas");
      buffer.width = base.naturalWidth;
      buffer.height = base.naturalHeight;
      const context = buffer.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.drawImage(base, 0, 0);
      if (!(revealed && hideMasks))
        context.drawImage(
          mask,
          0,
          0,
          buffer.width,
          (mask.naturalHeight * buffer.width) / mask.naturalWidth,
        );
      const output = canvas.current;
      output.width = buffer.width;
      output.height = buffer.height;
      output.getContext("2d")!.drawImage(buffer, 0, 0);
      setReady(true);
    };
    void run().catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
    };
  }, [note, type, revealed, urls, loading, hideMasks]);
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
                revealed ? "Image occlusion answer" : "Image occlusion question"
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
          {ready && revealed && (
            <button
              className="text-button"
              onClick={() => setHideMasks((v) => !v)}
            >
              {hideMasks ? "Show masks" : "Hide remaining masks"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
