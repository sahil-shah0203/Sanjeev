import createDOMPurify from "dompurify";
import katex from "katex";

export function safeHtml(
  html: string,
  media: Map<string, string>,
  win: Window,
): string {
  const purifier = createDOMPurify(
    win as unknown as Parameters<typeof createDOMPurify>[0],
  );
  const withAudio = html.replace(
    /\[sound:([^\]]+)\]/gi,
    (_, name: string) =>
      `<audio controls src="${name.replace(/["<>]/g, "")}"></audio>`,
  );
  const clean = purifier.sanitize(withAudio, {
    ALLOWED_TAGS: [
      "div",
      "span",
      "p",
      "br",
      "hr",
      "b",
      "strong",
      "em",
      "i",
      "u",
      "s",
      "sup",
      "sub",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "img",
      "audio",
      "video",
      "source",
      "blockquote",
      "pre",
      "code",
      "h1",
      "h2",
      "h3",
      "h4",
      "a",
      "small",
    ],
    ALLOWED_ATTR: [
      "src",
      "alt",
      "colspan",
      "rowspan",
      "class",
      "controls",
      "title",
    ],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const doc = win.document.createElement("div");
  doc.innerHTML = clean;
  for (const el of doc.querySelectorAll("*")) {
    if (el.hasAttribute("class")) {
      const classes = (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter((c) =>
          ["cloze-gap", "cloze-answer", "typed-prompt"].includes(c),
        );
      if (classes.length) el.setAttribute("class", classes.join(" "));
      else el.removeAttribute("class");
    }
    // Source-provided title text may contain an answer; only the rendered content is used.
    el.removeAttribute("title");
    if (["IMG", "AUDIO", "VIDEO", "SOURCE"].includes(el.tagName)) {
      let name = el.getAttribute("src") ?? "";
      try {
        name = decodeURIComponent(name);
      } catch {}
      const url = media.get(name);
      if (!url) {
        const placeholder = win.document.createElement("span");
        placeholder.className = "missing-media";
        placeholder.textContent = /^https?:/i.test(name)
          ? "[External media blocked]"
          : "[Media unavailable]";
        el.replaceWith(placeholder);
        continue;
      }
      el.setAttribute("src", url);
      if (el.tagName === "IMG") {
        el.setAttribute("loading", "lazy");
        el.setAttribute("decoding", "async");
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        const description = el.getAttribute("alt")?.trim();
        el.setAttribute(
          "aria-label",
          description
            ? `Open image viewer: ${description}`
            : "Open image viewer",
        );
      } else if (el.tagName !== "SOURCE") {
        el.setAttribute("controls", "");
        el.setAttribute("preload", "none");
      }
    }
  }
  const walker = win.document.createTreeWalker(doc, 4);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const value = node.textContent ?? "";
    const re = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
    if (!re.test(value)) continue;
    re.lastIndex = 0;
    const fragment = win.document.createDocumentFragment();
    let offset = 0,
      m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      fragment.append(
        win.document.createTextNode(value.slice(offset, m.index)),
      );
      const span = win.document.createElement("span");
      span.innerHTML = katex.renderToString(m[1] ?? m[2], {
        throwOnError: false,
        trust: false,
        strict: "error",
        displayMode: !!m[2],
        maxExpand: 100,
        maxSize: 20,
      });
      fragment.append(span);
      offset = re.lastIndex;
    }
    fragment.append(win.document.createTextNode(value.slice(offset)));
    node.replaceWith(fragment);
  }
  return doc.innerHTML;
}
