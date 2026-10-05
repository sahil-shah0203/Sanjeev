import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const SVG = "http://www.w3.org/2000/svg";
const elements = new Set([
  "svg",
  "g",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "path",
  "line",
  "text",
  "tspan",
  "title",
  "desc",
]);
const geometry = new Set([
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "width",
  "height",
  "rx",
  "ry",
  "r",
  "cx",
  "cy",
  "dx",
  "dy",
  "viewBox",
  "points",
  "d",
  "transform",
]);
const presentation = new Set([
  "fill",
  "stroke",
  "color",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "fill-rule",
  "clip-rule",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "display",
  "visibility",
  "vector-effect",
  "preserveAspectRatio",
]);

/** Rebuild a static drawing. Reject unsupported graphics instead of dropping a
 * mask and accidentally exposing its answer. Never attach imported SVG to DOM. */
export function safeSvg(source: string): string {
  if (
    source.length > 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)
  )
    throw new Error("SVG declarations or size are unsupported.");
  const document = new DOMParser({
    onError: () => {
      throw new Error("Invalid SVG XML.");
    },
  }).parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.localName !== "svg" || root.namespaceURI !== SVG)
    throw new Error("Invalid SVG root.");
  const output = document.implementation.createDocument(SVG, "svg", null);
  let count = 0;
  const attribute = (target: typeof root, name: string, value: string) => {
    if (!geometry.has(name) && !presentation.has(name))
      throw new Error(`Unsupported SVG attribute: ${name}`);
    // No URL-valued paints, CSS escapes, entity tricks, resources or CSS variables.
    if (
      !/^[\w\s.,%#()+\-]*$/.test(value) ||
      /url|var\s*\(|expression/i.test(value)
    )
      throw new Error("SVG resource references are unsupported.");
    if (
      name === "transform" &&
      !/^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([\d\s.,eE+\-]+\)\s*)*$/.test(
        value,
      )
    )
      throw new Error("Unsupported SVG transform.");
    // Some older mask editors emitted these invalid presentation values. Keep
    // the browser's normal fallback instead of turning them into valid paints.
    if (value === "null" || value === "#0") return;
    target.setAttribute(name, value);
  };
  const copy = (node: typeof root, target: typeof root, depth: number) => {
    if (
      ++count > 4096 ||
      depth > 32 ||
      !elements.has(node.localName ?? "") ||
      node.namespaceURI !== SVG
    )
      throw new Error("Unsupported SVG drawing or complexity.");
    if (depth && node.localName === "svg")
      throw new Error("Nested SVG viewports are unsupported.");
    for (let i = 0; i < node.attributes.length; i++) {
      const a = node.attributes.item(i)!;
      if (
        a.name === "xmlns" ||
        a.name.startsWith("xmlns:") ||
        a.name === "id" ||
        a.name === "class"
      )
        continue;
      if (a.name !== "style") attribute(target, a.name, a.value);
    }
    // Inline presentation wins over presentation attributes regardless of XML
    // attribute order. Flatten it only after copying the regular attributes.
    const style = node.getAttribute("style");
    if (style) {
      for (const part of style.split(";").filter((p) => p.trim())) {
        const colon = part.indexOf(":");
        const name = part.slice(0, colon).trim(),
          value = part.slice(colon + 1).trim();
        if (colon < 0 || !presentation.has(name))
          throw new Error("Unsupported SVG style.");
        attribute(target, name, value);
      }
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) {
        const element = child as typeof root;
        const next = output.createElementNS(SVG, element.localName!);
        copy(element, next, depth + 1);
        target.appendChild(next);
      } else if (child.nodeType === 3 || child.nodeType === 4) {
        target.appendChild(output.createTextNode(child.nodeValue ?? ""));
      } else if (child.nodeType !== 8)
        throw new Error("Unsupported SVG instruction.");
    }
  };
  copy(root, output.documentElement!, 0);
  const out = output.documentElement!;
  const box = out
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const dimension = (name: string, fallback?: number) => {
    const value = out.getAttribute(name);
    const n = value
      ? /^\d+(?:\.\d+)?(?:px)?$/.test(value)
        ? parseFloat(value)
        : NaN
      : fallback;
    if (!n || !Number.isFinite(n) || n <= 0 || n > 32768)
      throw new Error("Unsupported SVG dimensions.");
    out.setAttribute(name, String(n));
    return n;
  };
  if (
    box &&
    (box.length !== 4 ||
      box.some((v) => !Number.isFinite(v)) ||
      box[2] <= 0 ||
      box[3] <= 0)
  )
    throw new Error("Invalid SVG viewBox.");
  if (dimension("width", box?.[2]) * dimension("height", box?.[3]) > 40000000)
    throw new Error("SVG exceeds the image pixel limit.");
  return new XMLSerializer().serializeToString(output);
}

export function looksLikeSvg(bytes: Uint8Array): boolean {
  return /<svg(?:\s|>)/i.test(
    new TextDecoder().decode(bytes.subarray(0, 4096)),
  );
}
