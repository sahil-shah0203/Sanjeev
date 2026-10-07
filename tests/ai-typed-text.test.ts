// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi, afterEach } from "vitest";
import AiTypedText from "../apps/web/components/AiTypedText";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(reduced: boolean) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  window.matchMedia = vi.fn(() => ({
    matches: reduced,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(performance, "now").mockReturnValue(0);
  const container = document.createElement("div");
  const root = createRoot(container);
  const text = "Explain 👩🏽‍⚕️ this fact.";
  await act(async () => root.render(createElement(AiTypedText, { text })));
  return {
    container,
    root,
    text,
    tick: async (time: number) => act(async () => frame?.(time)),
  };
}
it("reveals AI text progressively while keeping the complete accessible text and stable layout", async () => {
  const view = await render(false);
  try {
    expect(view.container.querySelector(".sr-only")?.textContent).toBe(
      view.text,
    );
    expect(
      view.container
        .querySelector(".ai-typed-visual")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(view.container.querySelector(".ai-typed-layout")?.textContent).toBe(
      view.text,
    );
    expect(view.container.querySelector(".ai-typed-copy")?.textContent).toBe(
      "",
    );
    await view.tick(120);
    const partial = view.container.querySelector(".ai-typed-copy")?.textContent;
    expect(partial?.length).toBeGreaterThan(0);
    expect(partial).not.toBe(view.text);
    await view.tick(2000);
    expect(view.container.querySelector(".ai-typed-copy")?.textContent).toBe(
      view.text,
    );
  } finally {
    await act(async () => view.root.unmount());
  }
});
it("shows everything immediately when reduced motion is enabled", async () => {
  const view = await render(true);
  try {
    expect(view.container.querySelector(".ai-typed-copy")?.textContent).toBe(
      view.text,
    );
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  } finally {
    await act(async () => view.root.unmount());
  }
});
