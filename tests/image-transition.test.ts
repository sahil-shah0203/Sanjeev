// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi, afterEach } from "vitest";
import EnhancedOcclusionImage from "../apps/web/components/EnhancedOcclusionImage";
import type { Note, NoteType } from "@recall/domain";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("keeps the masked question canvas visible until the answer is decoded without decoding the base again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolveAnswer!: () => void;
  const answer = new Promise<void>((resolve) => {
    resolveAnswer = resolve;
  });
  const decode = vi.fn(function (this: { src: string }) {
    return this.src === "blob:answer" ? answer : Promise.resolve();
  });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = 100;
      naturalHeight = 100;
      decode = decode;
    },
  );
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage }) as unknown as CanvasRenderingContext2D,
  );
  const type = {
    fields: ["Image", "Question Mask", "Answer Mask"],
  } as NoteType;
  const note = {
    fields: [
      '<img src="base.png">',
      '<img src="question.svg">',
      '<img src="answer.svg">',
    ],
  } as Note;
  const urls = new Map([
    ["base.png", "blob:base"],
    ["question.svg", "blob:question"],
    ["answer.svg", "blob:answer"],
  ]);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        createElement(EnhancedOcclusionImage, {
          note,
          type,
          urls,
          loading: false,
          revealed: false,
        }),
      );
    });
    const canvas = container.querySelector("canvas")!;
    expect(canvas.style.display).toBe("block");
    expect(container.textContent).not.toContain("Preparing");
    await act(async () => {
      root.render(
        createElement(EnhancedOcclusionImage, {
          note,
          type,
          urls,
          loading: false,
          revealed: true,
        }),
      );
    });
    expect(container.querySelector("canvas")).toBe(canvas);
    expect(canvas.style.display).toBe("block");
    expect(canvas.getAttribute("aria-label")).toBe("Image occlusion question");
    expect(container.textContent).not.toContain("Preparing");
    await act(async () => {
      resolveAnswer();
    });
    expect(canvas.getAttribute("aria-label")).toBe("Image occlusion answer");
    expect(decode).toHaveBeenCalledTimes(3);
  } finally {
    await act(async () => root.unmount());
  }
});
