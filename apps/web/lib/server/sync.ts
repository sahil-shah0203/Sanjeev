import { z } from "zod";
import {
  ActivitySchema,
  MutationSchema,
  StateSchema,
  ReviewEventSchema,
  UndoEventSchema,
  validateRecord,
  stableJson,
  type Mutation,
  type ReviewEvent,
  type UndoEvent,
  type CardState,
} from "@recall/domain";
import { reconcileReview, reconcileUndo } from "@recall/sync";
import { transaction } from "./database";
import { HttpError } from "./auth";
import type { PoolClient } from "pg";
const batchSchema = z.object({
  schemaVersion: z.literal(1),
  mutations: z.array(MutationSchema).min(1).max(50),
});
async function get(
  db: PoolClient,
  owner: string,
  entity: string,
  id: string,
  lock = false,
) {
  return (
    await db.query(
      `SELECT * FROM public.documents WHERE owner_id=$1 AND entity=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`,
      [owner, entity, id],
    )
  ).rows[0];
}
async function put(
  db: PoolClient,
  owner: string,
  entity: string,
  id: string,
  value: unknown,
) {
  const result = await db.query(
    "INSERT INTO public.documents(owner_id,entity,id,value) VALUES ($1,$2,$3,$4) ON CONFLICT(owner_id,entity,id) DO UPDATE SET value=EXCLUDED.value,row_version=documents.row_version+1,updated_at=now(),deleted=false RETURNING row_version",
    [owner, entity, id, JSON.stringify(value)],
  );
  return result.rows[0].row_version;
}
async function ownedRef(
  db: PoolClient,
  owner: string,
  entity: string,
  id: unknown,
) {
  if (typeof id !== "string" || !(await get(db, owner, entity, id)))
    throw new HttpError(
      400,
      "MISSING_REFERENCE",
      "A referenced source record is missing or not owned by this account.",
    );
}
async function validatePut(db: PoolClient, owner: string, m: Mutation) {
  validateRecord(m.entity, m.value);
  const value = m.value as Record<string, any>;
  if (!value || value.id !== m.entityId)
    throw new HttpError(400, "INVALID_ENTITY", "Record identifier mismatch.");
  if (m.entity === "notes") {
    await ownedRef(db, owner, "types", value.typeId);
    if (
      !Array.isArray(value.fields) ||
      !value.fields.every((f: unknown) => typeof f === "string")
    )
      throw new HttpError(400, "INVALID_NOTE", "Invalid source fields.");
  }
  if (m.entity === "cards") {
    await ownedRef(db, owner, "notes", value.noteId);
    await ownedRef(db, owner, "decks", value.deckId);
  }
  if (m.entity === "states") {
    StateSchema.parse(value.memory);
    await ownedRef(db, owner, "cards", value.id);
    const existing = await get(db, owner, "states", value.id);
    if (existing)
      throw new HttpError(
        409,
        "STATE_REQUIRES_EVENT",
        "Existing schedules can change only through validated review or undo events.",
      );
  }
  if (m.entity === "activities") {
    const activity = ActivitySchema.parse(value);
    const existing = await get(db, owner, "activities", value.id);
    if (
      activity.status === "human_approved" &&
      (!existing || stableJson(existing.value) !== stableJson(activity))
    )
      throw new HttpError(
        403,
        "REVIEW_REQUIRED",
        "Only the protected content review workflow can approve an activity.",
      );
    for (const s of activity.sources)
      await ownedRef(db, owner, "notes", s.noteId);
  }
  if (m.entity === "attempts")
    await ownedRef(db, owner, "activities", value.activityId);
  if (m.entity === "reviews" || m.entity === "undos")
    throw new HttpError(
      400,
      "EVENT_REQUIRED",
      "Use an event mutation for review history.",
    );
}
export async function push(owner: string, input: unknown) {
  const { mutations } = batchSchema.parse(input);
  const results = [];
  for (const mutation of mutations) {
    try {
      const result = await transaction(owner, async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          owner,
        ]);
        const prior = (
          await db.query(
            "SELECT receipt FROM public.mutation_receipts WHERE owner_id=$1 AND mutation_id=$2",
            [owner, mutation.id],
          )
        ).rows[0];
        if (prior) return prior.receipt;
        let conflict: string | undefined;
        let version = 0;
        if (mutation.kind === "review") {
          const event = mutation.value as ReviewEvent;
          ReviewEventSchema.parse(event);
          if (
            event.id !== mutation.id ||
            event.id !== mutation.entityId ||
            mutation.entity !== "reviews"
          )
            throw new HttpError(
              400,
              "INVALID_EVENT",
              "Event identifiers do not match.",
            );
          const row = await get(db, owner, "states", event.cardId, true);
          if (!row)
            throw new HttpError(
              409,
              "STATE_MISSING",
              "The original card state must sync before its review.",
            );
          const source = await get(db, owner, "cards", event.cardId);
          const note = await get(db, owner, "notes", source?.value.noteId);
          let result;
          if (note?.value.version !== event.contentVersion) {
            result = {
              state: row.value,
              event: { ...event, status: "concurrent" },
              conflict:
                "Source content changed before reconciliation. Review retained as exposure.",
            };
          } else
            result = reconcileReview(
              row.value,
              event,
              new Date().toISOString(),
            );
          version = await put(db, owner, "reviews", event.id, result.event);
          conflict = result.conflict;
          if (!conflict)
            await put(db, owner, "states", event.cardId, result.state);
        } else if (mutation.kind === "undo") {
          const undo = UndoEventSchema.parse(mutation.value) as UndoEvent;
          if (
            mutation.entity !== "undos" ||
            undo.id !== mutation.id ||
            undo.id !== mutation.entityId
          )
            throw new HttpError(
              400,
              "INVALID_UNDO",
              "Undo identifiers do not match.",
            );
          const row = await get(db, owner, "states", undo.cardId, true);
          const review = await get(db, owner, "reviews", undo.reviewId);
          if (!row || !review)
            throw new HttpError(
              409,
              "UNDO_MISSING",
              "The review to undo must sync first.",
            );
          try {
            const restored = reconcileUndo(row.value, undo, review.value);
            await put(db, owner, "states", undo.cardId, restored);
            await put(db, owner, "reviews", undo.reviewId, {
              ...review.value,
              status: "undone",
            });
          } catch (e) {
            conflict =
              e instanceof Error
                ? e.message
                : "Undo conflicts with later work.";
          }
          version = await put(db, owner, "undos", undo.id, {
            ...undo,
            conflict,
          });
        } else if (mutation.kind === "archive") {
          if (!["reviews", "undos"].includes(mutation.entity))
            throw new HttpError(
              400,
              "INVALID_ARCHIVE",
              "Only review and undo audit records can be restored.",
            );
          validateRecord(mutation.entity, mutation.value);
          const value = mutation.value as ReviewEvent | UndoEvent;
          if (value.id !== mutation.entityId)
            throw new HttpError(
              400,
              "INVALID_ARCHIVE",
              "Archive identity mismatch.",
            );
          await ownedRef(db, owner, "cards", value.cardId);
          if (mutation.entity === "reviews")
            await ownedRef(db, owner, "notes", (value as ReviewEvent).noteId);
          else
            await ownedRef(db, owner, "reviews", (value as UndoEvent).reviewId);
          const priorRecord = await get(db, owner, mutation.entity, value.id);
          if (priorRecord) {
            version = priorRecord.row_version;
            if (stableJson(priorRecord.value) !== stableJson(value))
              conflict =
                "Existing history preserved; restored copy retained in the receipt.";
          } else
            version = await put(db, owner, mutation.entity, value.id, value);
        } else if (mutation.kind === "delete") {
          if (["states", "reviews", "undos"].includes(mutation.entity))
            throw new HttpError(
              400,
              "AUDIT_IMMUTABLE",
              "Audit history cannot be deleted individually.",
            );
          await db.query(
            "UPDATE public.documents SET deleted=true,row_version=row_version+1,updated_at=now() WHERE owner_id=$1 AND entity=$2 AND id=$3",
            [owner, mutation.entity, mutation.entityId],
          );
        } else {
          const existing = await get(
            db,
            owner,
            mutation.entity,
            mutation.entityId,
            true,
          );
          if (existing && mutation.entity === "states") {
            if (stableJson(existing.value) !== stableJson(mutation.value))
              conflict =
                "A state snapshot already exists. Canonical progress was preserved.";
            version = existing.row_version;
          } else if (
            existing &&
            mutation.entity === "notes" &&
            existing.value.version !== (mutation.value as any).version &&
            existing.value.version !==
              (mutation.value as any).revisions?.at(-1)?.version
          ) {
            conflict =
              "Source edits conflict; both versions are retained in the mutation receipt.";
            version = existing.row_version;
          } else {
            await validatePut(db, owner, mutation);
            version = await put(
              db,
              owner,
              mutation.entity,
              mutation.entityId,
              mutation.value,
            );
          }
        }
        const receipt = {
          id: mutation.id,
          status: conflict ? "conflict" : "ok",
          version,
          conflict,
          proposed: conflict ? mutation : undefined,
        };
        await db.query(
          "INSERT INTO public.mutation_receipts(owner_id,mutation_id,receipt,payload) VALUES ($1,$2,$3,$4)",
          [
            owner,
            mutation.id,
            JSON.stringify(receipt),
            JSON.stringify(mutation),
          ],
        );
        return receipt;
      });
      results.push(result);
    } catch (e) {
      results.push({
        id: mutation.id,
        status: "error",
        message:
          e instanceof HttpError
            ? e.message
            : "This change failed validation. Local work is preserved.",
      });
      break;
    }
  }
  return { results };
}
export async function pull(owner: string, cursor: number, limit: number) {
  return transaction(owner, async (db) => {
    const rows = (
      await db.query(
        'SELECT cursor,entity,entity_id AS "entityId",value,row_version AS version,deleted FROM public.change_log WHERE owner_id=$1 AND cursor>$2 ORDER BY cursor LIMIT $3',
        [owner, cursor, limit + 1],
      )
    ).rows;
    return {
      changes: rows
        .slice(0, limit)
        .map((r) => ({ ...r, cursor: Number(r.cursor) })),
      nextCursor: rows.length
        ? Number(rows[Math.min(rows.length, limit) - 1].cursor)
        : cursor,
      hasMore: rows.length > limit,
    };
  });
}
