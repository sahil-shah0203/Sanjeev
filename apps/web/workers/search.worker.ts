import { stripHtml } from "@recall/card-renderer";
type Row = {
  id: string;
  text: string;
  tags: string[];
  deckId: string;
  status: string;
  searchText?: string;
};
let rows: Row[] = [];
self.onmessage = (e: MessageEvent) => {
  if (e.data.kind === "index") {
    rows = e.data.rows.map((r: Row) => ({
      ...r,
      searchText:
        `${stripHtml(r.text)} ${r.tags.join(" ")}`.toLocaleLowerCase(),
    }));
    return;
  }
  const { query = "", deckId = "", status = "", page = 0, requestId } = e.data;
  const terms = String(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const hits = rows.filter(
    (r) =>
      (!deckId || r.deckId === deckId) &&
      (!status || r.status === status) &&
      terms.every((t) => r.searchText!.includes(t)),
  );
  postMessage({
    requestId,
    total: hits.length,
    ids: hits.slice(page * 50, page * 50 + 50).map((r) => r.id),
  });
};
