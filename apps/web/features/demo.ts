import { hash, id, now, type ImportBundle } from "@recall/domain";
export async function demoBundle(): Promise<ImportBundle> {
  const namespace = "c2efc31b-40b0-42b8-ab94-6f03b4cd2b80",
    importId = id(),
    deckId = id(),
    typeId = id();
  const prompts = [
    "A triangle has {{c1::three}} sides.",
    "The chemical symbol for oxygen is {{c1::O}}.",
    "The Earth orbits the {{c1::Sun}}.",
    "A minute contains {{c1::60}} seconds.",
    "Water freezes at {{c1::0}} °C at standard atmospheric pressure.",
    "A hexagon has {{c1::six}} sides.",
  ];
  const notes = await Promise.all(
    prompts.map(async (text, i) => ({
      id: id(),
      namespace,
      originalId: String(1700000000000 + i),
      guid: `recall-demo-${i}`,
      typeId,
      fields: [text, "Synthetic demonstration card."],
      tags: ["Recall::Demo"],
      version: await hash(
        JSON.stringify([text, "Synthetic demonstration card."]),
      ),
      raw: {},
      revisions: [],
    })),
  );
  const cards = notes.map((n, i) => ({
    id: id(),
    namespace,
    originalId: String(1700000000100 + i),
    noteId: n.id,
    deckId,
    ord: 0,
    supported: true,
    suspended: false,
    flagged: false,
    raw: {},
  }));
  return {
    report: {
      id: importId,
      namespace,
      hash: await hash("recall-synthetic-demo-v1"),
      filename: "Recall demonstration",
      bytes: 0,
      format: "Synthetic demo",
      parserVersion: "1",
      createdAt: now(),
      status: "staged",
      notes: notes.length,
      cards: cards.length,
      ready: cards.length,
      media: 0,
      missingMedia: [],
      warnings: [
        "These synthetic demonstration cards are not a medical curriculum.",
      ],
      historyCount: 0,
      rawCollection: {},
      history: [],
      historyMode: "fresh",
    },
    decks: [
      {
        id: deckId,
        namespace,
        originalId: "1700000000001",
        name: "A little practice",
        importId,
      },
    ],
    types: [
      {
        id: typeId,
        originalId: "1700000000002",
        name: "Recall cloze",
        kind: "cloze",
        fields: ["Text", "Extra"],
        templates: [
          {
            name: "Cloze",
            ord: 0,
            front: "{{cloze:Text}}",
            back: "{{cloze:Text}}<hr>{{Extra}}",
          },
        ],
        css: "",
        raw: {},
      },
    ],
    notes,
    cards,
    media: [],
  };
}
