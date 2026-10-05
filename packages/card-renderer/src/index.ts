import { type Note, type NoteType } from "@recall/domain";
import { occlusionShapes } from "./occlusion";
import { isEnhancedOcclusion, enhancedOcclusion } from "./enhanced-occlusion";

export interface ClozePart {
  kind: "text" | "cloze";
  text: string;
  index?: number;
  hint?: string;
}
export function parseCloze(input: string): ClozePart[] {
  const parts: ClozePart[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const open = input.indexOf("{{c", cursor);
    if (open < 0) {
      parts.push({ kind: "text", text: input.slice(cursor) });
      break;
    }
    if (open > cursor)
      parts.push({ kind: "text", text: input.slice(cursor, open) });
    const prefix = /^\{\{c(\d+)::/.exec(input.slice(open));
    if (!prefix) {
      parts.push({ kind: "text", text: input.slice(open, open + 3) });
      cursor = open + 3;
      continue;
    }
    const start = open + prefix[0].length;
    const close = input.indexOf("}}", start);
    if (close < 0) throw new Error("Unclosed cloze deletion.");
    const value = input.slice(start, close);
    if (value.includes("{{"))
      throw new Error("Nested cloze deletions need a compatible template.");
    const hintAt = value.indexOf("::");
    parts.push({
      kind: "cloze",
      index: Number(prefix[1]),
      text: hintAt < 0 ? value : value.slice(0, hintAt),
      hint: hintAt < 0 ? undefined : value.slice(hintAt + 2),
    });
    cursor = close + 2;
  }
  return parts;
}
/** Returns source text with Anki cloze delimiters removed for browse/search previews. */
export function stripCloze(input: string): string {
  try {
    return parseCloze(input)
      .map((part) => part.text)
      .join("");
  } catch {
    return input.replace(/\{\{c\d+::/gi, "").replace(/\}\}/g, "");
  }
}
export const stripHtml = (html: string) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderCloze(
  input: string,
  index: number,
  revealed: boolean,
  revealedCount = Infinity,
): string {
  let occurrence = 0;
  return parseCloze(input)
    .map((p) => {
      if (p.kind === "text") return p.text;
      if (p.index !== index) return p.text;
      const show = revealed || occurrence++ < revealedCount;
      return show
        ? `<span class="cloze-answer">${p.text}</span>`
        : `<span class="cloze-gap">[${escapeHtml(stripHtml(p.hint ?? "…"))}]</span>`;
    })
    .join("");
}
export function clozeCount(type: NoteType, note: Note, ord: number): number {
  if (type.kind !== "cloze") return 0;
  return parseCloze(
    note.fields[type.fields.findIndex((f) => f === "Text")] ??
      note.fields[0] ??
      "",
  ).filter((p) => p.kind === "cloze" && p.index === ord + 1).length;
}
export const oneByOne = (type: NoteType, note: Note) =>
  /anking/i.test(type.name) &&
  type.fields.some(
    (f, i) => /one.?by.?one/i.test(f) && !!stripHtml(note.fields[i] ?? ""),
  );

function template(
  input: string,
  values: Record<string, string>,
  clozeIndex: number,
  answer: boolean,
  count: number,
  frontSide = "",
): string {
  let output = "",
    cursor = 0;
  const stack: { name: string; visible: boolean }[] = [];
  const token = /\{\{([^{}]+)\}\}/g;
  let m: RegExpExecArray | null;
  const visible = () => stack.every((s) => s.visible);
  while ((m = token.exec(input))) {
    if (visible()) output += input.slice(cursor, m.index);
    cursor = token.lastIndex;
    const key = m[1].trim();
    if (key[0] === "#" || key[0] === "^") {
      const name = key.slice(1);
      const present =
        !!stripHtml(values[name] ?? "") ||
        /<(?:img|audio|video)\b|\[sound:/i.test(values[name] ?? "");
      stack.push({ name, visible: key[0] === "#" ? present : !present });
      continue;
    }
    if (key[0] === "/") {
      if (stack.pop()?.name !== key.slice(1))
        throw new Error("Mismatched conditional template.");
      continue;
    }
    if (!visible()) continue;
    if (key === "FrontSide") {
      output += frontSide;
      continue;
    }
    const bits = key.split(":");
    const field = bits.pop()!;
    let value = values[field] ?? "";
    for (const filter of bits.reverse()) {
      if (filter === "cloze")
        value = renderCloze(value, clozeIndex, answer, count);
      else if (filter === "text") value = escapeHtml(stripHtml(value));
      else if (filter === "type")
        value = answer
          ? value
          : '<span class="typed-prompt">Recall the answer before revealing.</span>';
      else throw new Error(`Unsupported template filter: ${filter}`);
    }
    output += value;
  }
  if (stack.length) throw new Error("Unclosed conditional template.");
  if (visible()) output += input.slice(cursor);
  return output;
}
export function compatibility(
  type: NoteType,
  note: Note,
  ord: number,
): { supported: boolean; reason?: string } {
  try {
    if (isEnhancedOcclusion(type)) {
      enhancedOcclusion(type, note);
      return { supported: true };
    }
    if (type.kind === "occlusion") {
      occlusionShapes(note.fields[0], ord + 1);
      if (!/<img\b[^>]*\bsrc=["'][^"']+["']/i.test(note.fields[1] ?? ""))
        throw new Error("Image-occlusion source image is missing.");
      return { supported: true };
    }
    if (/image.?occlusion/i.test(type.name))
      return {
        supported: false,
        reason:
          "Third-party image occlusion needs an adapter; the original is preserved.",
      };
    if (!type.templates.length)
      return { supported: false, reason: "No card template found." };
    if (type.fields.length !== note.fields.length)
      return {
        supported: false,
        reason: "Field count does not match the note type.",
      };
    if (type.kind === "cloze" && clozeCount(type, note, ord) === 0)
      return {
        supported: false,
        reason: "The imported cloze ordinal has no target.",
      };
    const nativeAnking =
      /anking/i.test(type.name) &&
      type.kind === "cloze" &&
      type.fields.includes("Text");
    if (
      !nativeAnking &&
      type.templates.some((t) =>
        /<script\b|onload\s*=|<iframe\b/i.test(t.front + t.back),
      )
    )
      return {
        supported: false,
        reason:
          "This template depends on unsupported scripts or embedded pages.",
      };
    renderCard(type, note, ord, false, 0);
    renderCard(type, note, ord, true);
    return { supported: true };
  } catch (e) {
    return {
      supported: false,
      reason: e instanceof Error ? e.message : "Unsupported template.",
    };
  }
}
export function renderCard(
  type: NoteType,
  note: Note,
  ord: number,
  answer: boolean,
  count = 0,
): { html: string; extras: { name: string; html: string }[] } {
  if (isEnhancedOcclusion(type)) {
    const field = (name: string) =>
      note.fields[type.fields.indexOf(name)] ?? "";
    return {
      html: field("Header"),
      extras: answer
        ? ["Footer", "Remarks", "Sources", "Extra 1", "Extra 2"]
            .filter((name) => field(name).trim())
            .map((name) => ({ name, html: field(name) }))
        : [],
    };
  }
  if (type.kind === "occlusion")
    return {
      html: note.fields[2] ?? "",
      extras: answer
        ? [{ name: "Back extra", html: note.fields[3] ?? "" }]
        : [],
    };
  const values: Record<string, string> = Object.fromEntries(
    type.fields.map((name, i) => [name, note.fields[i] ?? ""]),
  );
  values.Tags = note.tags.join(" ");
  values.Type = type.name;
  if (/anking/i.test(type.name) && type.kind === "cloze" && "Text" in values) {
    return {
      html: renderCloze(values.Text, ord + 1, answer, count),
      extras: answer
        ? type.fields
            .filter(
              (f) =>
                (f !== "Text" &&
                  !/one.?by.?one|^audio$|^id$/i.test(f) &&
                  stripHtml(values[f] ?? "")) ||
                (answer &&
                  f !== "Text" &&
                  /<img|\[sound:/.test(values[f] ?? "")),
            )
            .map((name) => ({ name, html: values[name] }))
        : [],
    };
  }
  const t = type.templates.find(
    (t) => t.ord === (type.kind === "cloze" ? 0 : ord),
  );
  if (!t) throw new Error("Missing imported card template.");
  const front = template(t.front, values, ord + 1, false, count);
  return {
    html: answer
      ? template(t.back, values, ord + 1, true, Infinity, front)
      : front,
    extras: [],
  };
}
