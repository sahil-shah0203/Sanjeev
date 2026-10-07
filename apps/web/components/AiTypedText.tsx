"use client";
import { useEffect, useMemo, useState } from "react";

/** Visual reveal only: full text remains available to assistive technology. */
export default function AiTypedText({ text }: { text: string }) {
  const letters = useMemo(
    () =>
      typeof Intl.Segmenter === "function"
        ? [
            ...new Intl.Segmenter(undefined, {
              granularity: "grapheme",
            }).segment(text),
          ].map((part) => part.segment)
        : Array.from(text),
    [text],
  );
  const [progress, setProgress] = useState({ text, count: 0 });
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const showAll = () => {
      cancelAnimationFrame(frame);
      setProgress({ text, count: letters.length });
    };
    const onMotion = () => {
      if (motion.matches) showAll();
    };
    motion.addEventListener("change", onMotion);
    if (motion.matches || document.hidden) showAll();
    else {
      setProgress({ text, count: 0 });
      const start = performance.now();
      const duration = Math.min(1600, Math.max(120, letters.length * 12));
      const tick = (time: number) => {
        const count = Math.min(
          letters.length,
          Math.floor(((time - start) / duration) * letters.length),
        );
        setProgress({ text, count });
        if (count < letters.length) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", onMotion);
    };
  }, [text, letters]);
  const count = progress.text === text ? progress.count : 0;
  return (
    <span className="ai-typed-text">
      <span className="sr-only">{text}</span>
      <span className="ai-typed-visual" aria-hidden="true" aria-live="off">
        <span className="ai-typed-layout">{text}</span>
        <span className="ai-typed-copy">
          {letters.slice(0, count).join("")}
        </span>
      </span>
    </span>
  );
}
