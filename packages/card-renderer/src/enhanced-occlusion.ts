import type { Note, NoteType } from "@recall/domain";

export const isEnhancedOcclusion = (type: NoteType) =>
  ["Image", "Question Mask", "Answer Mask"].every((field) =>
    type.fields.includes(field),
  );

export function enhancedOcclusion(type: NoteType, note: Note) {
  const image = (field: string) => {
    const html = note.fields[type.fields.indexOf(field)] ?? "";
    const matches = [
      ...html.matchAll(
        /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi,
      ),
    ];
    if (matches.length !== 1)
      throw new Error(
        `Image occlusion requires one ${field.toLowerCase()} image.`,
      );
    let name = (matches[0][1] ?? matches[0][2] ?? matches[0][3]).replace(
      /&amp;/g,
      "&",
    );
    try {
      name = decodeURIComponent(name);
    } catch {}
    if (/^(?:[a-z]+:|\/\/)/i.test(name))
      throw new Error("Image occlusion requires local media.");
    return name;
  };
  return {
    image: image("Image"),
    question: image("Question Mask"),
    answer: image("Answer Mask"),
  };
}
