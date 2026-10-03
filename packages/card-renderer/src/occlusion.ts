import { parseCloze } from "./index";
export interface Occlusion {
  ordinal: number;
  kind: "rect" | "ellipse" | "polygon";
  left: number;
  top: number;
  width: number;
  height: number;
  points?: { x: number; y: number }[];
  hideInactive: boolean;
}
export function occlusionShapes(field: string, ordinal: number): Occlusion[] {
  const parts = parseCloze(field);
  const shapes: Occlusion[] = [];
  for (const part of parts) {
    if (part.kind === "text") {
      if (part.text.replace(/<br\s*\/?>|\s/g, "").length)
        throw new Error("Unexpected image-occlusion markup.");
      continue;
    }
    if (!part.text.startsWith("image-occlusion:"))
      throw new Error("Unsupported image-occlusion syntax.");
    const tokens = part.text.split(":");
    const kind = tokens[1];
    if (!["rect", "ellipse", "polygon"].includes(kind))
      throw new Error(
        "Text annotations and custom image-occlusion shapes require a compatibility adapter.",
      );
    const props: Record<string, string> = {};
    for (const token of tokens.slice(2)) {
      const i = token.indexOf("=");
      if (i < 1) throw new Error("Malformed image mask property.");
      const key = token.slice(0, i);
      if (key in props) throw new Error("Duplicate image mask property.");
      props[key] = token.slice(i + 1);
    }
    if (
      Object.keys(props).some(
        (k) =>
          ![
            "left",
            "top",
            "width",
            "height",
            "rx",
            "ry",
            "points",
            "oi",
            "angle",
            "fill",
          ].includes(k),
      )
    )
      throw new Error("Unknown image mask property.");
    if (Number(props.angle ?? 0) !== 0)
      throw new Error("Rotated image masks need a validated adapter.");
    if (props.fill && props.fill !== "#ffeba2" && props.fill !== "#ff8e8e")
      throw new Error("Custom mask colors require review.");
    const num = (key: string, defaultValue?: number) => {
      const n = props[key] === undefined ? defaultValue : Number(props[key]);
      if (n === undefined || !Number.isFinite(n) || n < 0 || n > 1)
        throw new Error(
          "Image mask coordinates must be normalized between zero and one.",
        );
      return n;
    };
    const left = num("left", 0),
      top = num("top", 0);
    let width = 0,
      height = 0,
      points: Occlusion["points"];
    if (kind === "rect") {
      width = num("width");
      height = num("height");
    } else if (kind === "ellipse") {
      width = num("rx") * 2;
      height = num("ry") * 2;
    } else {
      points = (props.points ?? "")
        .split(" ")
        .filter(Boolean)
        .map((p) => {
          const [x, y] = p.split(",").map(Number);
          if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            x < 0 ||
            y < 0 ||
            x > 1 ||
            y > 1
          )
            throw new Error("Invalid polygon coordinates.");
          return { x, y };
        });
      if (points.length < 3 || points.length > 1000)
        throw new Error("Invalid image-occlusion polygon.");
      const minX = Math.min(...points.map((p) => p.x)),
        minY = Math.min(...points.map((p) => p.y));
      width = Math.max(...points.map((p) => p.x)) - minX;
      height = Math.max(...points.map((p) => p.y)) - minY;
      points = points.map((p) => ({
        x: p.x - minX + left,
        y: p.y - minY + top,
      }));
    }
    if (
      width <= 0 ||
      height <= 0 ||
      left + width > 1.001 ||
      top + height > 1.001
    )
      throw new Error("Image mask bounds exceed the image.");
    shapes.push({
      ordinal: part.index!,
      kind: kind as Occlusion["kind"],
      left,
      top,
      width,
      height,
      points,
      hideInactive: props.oi === "1",
    });
  }
  if (!shapes.some((s) => s.ordinal === ordinal))
    throw new Error("No image mask matches this card’s ordinal.");
  return shapes;
}
export function visibleMasks(
  shapes: Occlusion[],
  ordinal: number,
  revealed: boolean,
) {
  return shapes.filter(
    (s) =>
      s.ordinal === 0 ||
      (s.ordinal === ordinal && !revealed) ||
      (s.ordinal !== ordinal && s.hideInactive),
  );
}
