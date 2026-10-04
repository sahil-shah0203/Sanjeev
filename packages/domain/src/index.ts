import { z } from "zod";

export const SCHEMA_VERSION = 1;
export const POLICY_VERSION = "recall-1";
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}
export async function hash(
  data: string | Uint8Array | ArrayBuffer,
): Promise<string> {
  const bytes =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data as ArrayBuffer);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export type Raw = Record<string, unknown>;
export interface NoteType {
  id: string;
  originalId: string;
  name: string;
  kind: "basic" | "cloze" | "occlusion";
  fields: string[];
  templates: { name: string; ord: number; front: string; back: string }[];
  css: string;
  raw: Raw;
}
export interface Note {
  id: string;
  namespace: string;
  originalId: string;
  guid: string;
  typeId: string;
  fields: string[];
  tags: string[];
  version: string;
  raw: Raw;
  revisions: { version: string; fields: string[]; at: string }[];
}
export interface Deck {
  id: string;
  namespace: string;
  originalId: string;
  name: string;
  importId: string;
}
export interface SourceCard {
  id: string;
  namespace: string;
  originalId: string;
  noteId: string;
  deckId: string;
  ord: number;
  supported: boolean;
  reason?: string;
  suspended: boolean;
  buriedUntil?: string;
  flagged: boolean;
  raw: Raw;
}
export interface MediaAsset {
  id: string;
  namespace: string;
  name: string;
  hash: string;
  mime: string;
  size: number;
  blob: Blob;
  cloud?: boolean;
}
export interface ImportReport {
  id: string;
  namespace: string;
  hash: string;
  filename: string;
  bytes: number;
  format: string;
  parserVersion: string;
  createdAt: string;
  status: "staged" | "completed";
  notes: number;
  cards: number;
  ready: number;
  media: number;
  missingMedia: string[];
  warnings: string[];
  historyCount: number;
  rawCollection: Raw;
  history: Raw[];
  historyMode: "fresh" | "preserve_due" | "replay";
  originalPackage?: Blob;
}
export interface ImportBundle {
  report: ImportReport;
  decks: Deck[];
  types: NoteType[];
  notes: Note[];
  cards: SourceCard[];
  media: MediaAsset[];
}
export const StateSchema = z.object({
  due: z.iso.datetime(),
  stability: z.number().nonnegative(),
  difficulty: z.number().nonnegative(),
  elapsed_days: z.number(),
  scheduled_days: z.number(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: z.number().int().min(0).max(3),
  learning_steps: z.number().int().nonnegative(),
  last_review: z.iso.datetime().optional(),
});
export type MemoryState = z.infer<typeof StateSchema>;
export interface CardState {
  id: string;
  memory: MemoryState;
  version: number;
  head: string | null;
  origin: "fresh" | "review" | "partial_due" | "replay";
  config: SchedulerConfig;
}
export interface SchedulerConfig {
  version: string;
  library: string;
  retention: number;
  fuzz: false;
  learningSteps: string[];
  relearningSteps: string[];
}
export const RatingSchema = z.enum(["again", "hard", "good", "easy"]);
export type RecallRating = z.infer<typeof RatingSchema>;
export interface ReviewEvent {
  id: string;
  cardId: string;
  noteId: string;
  sessionId: string;
  deviceId: string;
  sequence: number;
  parent: string | null;
  baseVersion: number;
  at: string;
  effectiveAt: string;
  contentVersion: string;
  rating: RecallRating;
  before: CardState;
  after: CardState;
  config: SchedulerConfig;
  status: "pending" | "canonical" | "concurrent" | "undone";
  durationMs: number;
  studyDay: string;
}
export interface Exposure {
  id: string;
  cardId: string;
  noteId: string;
  sessionId: string;
  at: string;
  kind:
    "reveal" | "no_attempt" | "hint" | "skip" | "source" | "adaptive" | "undo";
  reviewId?: string;
  activityId?: string;
}
export interface UndoEvent {
  id: string;
  reviewId: string;
  cardId: string;
  at: string;
  restored: CardState;
}
export interface StudySession {
  id: string;
  deckId: string;
  startedAt: string;
  updatedAt: string;
  budgetMinutes: number;
  activeMs: number;
  reviews: number;
  checks: number;
  interventionMs: number;
  teachbacks: number;
  excluded: string[];
  lastCardId?: string;
  completed: boolean;
  seed: string;
  policy: string;
  interventions?: Intervention[];
}
export interface Intervention {
  id: string;
  activityId: string;
  activityVersion: string;
  reason: string;
  policy: string;
  startedAt: string;
  durationMs: number;
  expectedMs: number;
  requested: boolean;
  status: "open" | "completed" | "dismissed" | "interrupted";
}
export interface Preferences {
  id: "preferences";
  newLimit: number;
  retention: number;
  timezone: string;
  rollover: number;
  budgetMinutes: number;
  theme: "system" | "light" | "dark";
  adaptive: boolean;
  aiConsent: boolean;
  evaluationConsent: boolean;
  burySiblings: boolean;
}
export const defaults = (): Preferences => ({
  id: "preferences",
  newLimit: 20,
  retention: 0.9,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  rollover: 4,
  budgetMinutes: 15,
  theme: "system",
  adaptive: false,
  aiConsent: false,
  evaluationConsent: false,
  burySiblings: true,
});
export interface SourceRef {
  noteId: string;
  version: string;
  field: number;
  quote: string;
}
export const ActivitySchema = z.object({
  id: z.string().uuid(),
  version: z.string(),
  objective: z.string().min(3).max(1000),
  format: z.enum(["short_answer", "multiple_choice", "brief_explanation"]),
  cognitiveTask: z.enum(["recall", "explain", "discriminate", "apply"]),
  stem: z.string().min(3).max(3000),
  options: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
  acceptedAnswers: z.array(z.string()).optional(),
  correctOptionIds: z.array(z.string()).optional(),
  rubric: z
    .array(
      z.object({
        id: z.string(),
        criterion: z.string(),
        essential: z.boolean(),
      }),
    )
    .optional(),
  rationale: z.string().max(2000),
  distractorRationales: z.record(z.string(), z.string()).optional(),
  sources: z
    .array(
      z.object({
        noteId: z.string(),
        version: z.string(),
        field: z.number().int().min(0),
        quote: z.string().min(1),
      }),
    )
    .min(1),
  expectedSeconds: z.number().min(5).max(90),
  status: z.enum([
    "draft",
    "validated",
    "human_approved",
    "rejected",
    "quarantined",
  ]),
  modelVersion: z.string().nullable(),
  promptVersion: z.string(),
  validatorVersion: z.string(),
  reviewerId: z.string().optional(),
  approvedHash: z.string().optional(),
});
export type Activity = z.infer<typeof ActivitySchema>;
export type Grade = "correct" | "partially_correct" | "incorrect" | "uncertain";
export interface Attempt {
  id: string;
  activityId: string;
  activityVersion: string;
  sessionId: string;
  answer: string;
  at: string;
  durationMs: number;
  assistance: boolean;
  contaminated: boolean;
  grade: Grade;
  feedback: string;
  dispute?: string;
  adjudication?: string;
  format?: Activity["format"];
  cognitiveTask?: Activity["cognitiveTask"];
  objective?: string;
  selectionReason?: string;
  policy?: string;
}
export interface ContentReport {
  id: string;
  cardId?: string;
  activityId?: string;
  category: string;
  comment: string;
  at: string;
  status: "open" | "resolved";
}
export type Entity =
  | "imports"
  | "decks"
  | "types"
  | "notes"
  | "cards"
  | "states"
  | "exposures"
  | "sessions"
  | "activities"
  | "attempts"
  | "reports"
  | "preferences"
  | "undos";
export interface Mutation {
  id: string;
  kind: "put" | "review" | "undo" | "archive" | "delete";
  entity: Entity | "reviews";
  entityId: string;
  value: unknown;
  baseVersion: number;
  at: string;
}
export const MutationSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["put", "review", "undo", "archive", "delete"]),
  entity: z.enum([
    "imports",
    "decks",
    "types",
    "notes",
    "cards",
    "states",
    "exposures",
    "sessions",
    "activities",
    "attempts",
    "reports",
    "preferences",
    "undos",
    "reviews",
  ]),
  entityId: z.string().min(1).max(200),
  value: z.unknown(),
  baseVersion: z.number().int().nonnegative(),
  at: z.iso.datetime(),
});
export interface Change {
  cursor: number;
  entity: Entity | "reviews";
  entityId: string;
  value: unknown;
  version: number;
  deleted: boolean;
}
export const errorMessage = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "The operation could not be completed. Try again.";

// The same boundary validates cloud payloads and native restores. Raw Anki fields
// are deliberately retained, while all fields the application executes are typed.
const key = z.string().min(1).max(200),
  stamp = z.iso.datetime();
const rawSchema = z.record(z.string(), z.unknown());
export const SchedulerConfigSchema = z.object({
  version: z.string(),
  library: z.literal("ts-fsrs@5.4.2"),
  retention: z.number().min(0.7).max(0.99),
  fuzz: z.literal(false),
  learningSteps: z.tuple([z.literal("1m"), z.literal("10m")]),
  relearningSteps: z.tuple([z.literal("10m")]),
});
export const CardStateSchema = z.object({
  id: key,
  memory: StateSchema,
  version: z.number().int().nonnegative(),
  head: key.nullable(),
  origin: z.enum(["fresh", "review", "partial_due", "replay"]),
  config: SchedulerConfigSchema,
});
export const ReviewEventSchema = z.object({
  id: z.uuid(),
  cardId: key,
  noteId: key,
  sessionId: key,
  deviceId: key,
  sequence: z.number().int().nonnegative(),
  parent: key.nullable(),
  baseVersion: z.number().int().nonnegative(),
  at: stamp,
  effectiveAt: stamp,
  contentVersion: key,
  rating: RatingSchema,
  before: CardStateSchema,
  after: CardStateSchema,
  config: SchedulerConfigSchema,
  status: z.enum(["pending", "canonical", "concurrent", "undone"]),
  durationMs: z.number().nonnegative().max(86400000),
  studyDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export const UndoEventSchema = z
  .object({
    id: z.uuid(),
    reviewId: key,
    cardId: key,
    at: stamp,
    restored: CardStateSchema,
  })
  .passthrough();
export const recordSchemas = {
  types: z.object({
    id: key,
    originalId: key,
    name: z.string(),
    kind: z.enum(["basic", "cloze", "occlusion"]),
    fields: z.array(z.string()),
    templates: z.array(
      z.object({
        name: z.string(),
        ord: z.number().int().nonnegative(),
        front: z.string(),
        back: z.string(),
      }),
    ),
    css: z.string(),
    raw: rawSchema,
  }),
  notes: z.object({
    id: key,
    namespace: key,
    originalId: key,
    guid: key,
    typeId: key,
    fields: z.array(z.string()),
    tags: z.array(z.string()),
    version: key,
    raw: rawSchema,
    revisions: z.array(
      z.object({ version: key, fields: z.array(z.string()), at: stamp }),
    ),
  }),
  decks: z.object({
    id: key,
    namespace: key,
    originalId: key,
    name: z.string(),
    importId: key,
  }),
  cards: z.object({
    id: key,
    namespace: key,
    originalId: key,
    noteId: key,
    deckId: key,
    ord: z.number().int().nonnegative(),
    supported: z.boolean(),
    reason: z.string().optional(),
    suspended: z.boolean(),
    buriedUntil: stamp.optional(),
    flagged: z.boolean(),
    raw: rawSchema,
  }),
  imports: z.object({
    id: key,
    namespace: key,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    filename: z.string(),
    bytes: z.number().nonnegative(),
    format: z.string(),
    parserVersion: key,
    createdAt: stamp,
    status: z.enum(["staged", "completed"]),
    notes: z.number().int().nonnegative(),
    cards: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    media: z.number().int().nonnegative(),
    missingMedia: z.array(z.string()),
    warnings: z.array(z.string()),
    historyCount: z.number().int().nonnegative(),
    rawCollection: rawSchema,
    history: z.array(rawSchema),
    historyMode: z.enum(["fresh", "preserve_due", "replay"]),
  }),
  states: CardStateSchema,
  reviews: ReviewEventSchema,
  undos: UndoEventSchema,
  activities: ActivitySchema,
  exposures: z.object({
    id: key,
    cardId: z.string(),
    noteId: key,
    sessionId: key,
    at: stamp,
    kind: z.enum([
      "reveal",
      "no_attempt",
      "hint",
      "skip",
      "source",
      "adaptive",
      "undo",
    ]),
    reviewId: key.optional(),
    activityId: key.optional(),
  }),
  sessions: z.object({
    id: key,
    deckId: z.string(),
    startedAt: stamp,
    updatedAt: stamp,
    budgetMinutes: z.number().nonnegative().max(1440),
    activeMs: z.number().nonnegative(),
    reviews: z.number().int().nonnegative(),
    checks: z.number().int().nonnegative(),
    interventionMs: z.number().nonnegative(),
    teachbacks: z.number().int().nonnegative(),
    excluded: z.array(key),
    lastCardId: key.optional(),
    completed: z.boolean(),
    seed: key,
    policy: key,
    interventions: z
      .array(
        z.object({
          id: key,
          activityId: key,
          activityVersion: key,
          reason: z.string(),
          policy: key,
          startedAt: stamp,
          durationMs: z.number().nonnegative(),
          expectedMs: z.number().nonnegative(),
          requested: z.boolean(),
          status: z.enum(["open", "completed", "dismissed", "interrupted"]),
        }),
      )
      .optional(),
  }),
  attempts: z
    .object({
      id: key,
      activityId: key,
      activityVersion: key,
      sessionId: key,
      answer: z.string().max(16000),
      at: stamp,
      durationMs: z.number().nonnegative(),
      assistance: z.boolean(),
      contaminated: z.boolean(),
      grade: z.enum(["correct", "partially_correct", "incorrect", "uncertain"]),
      feedback: z.string(),
      dispute: z.string().optional(),
      adjudication: z.string().optional(),
    })
    .passthrough(),
  reports: z.object({
    id: key,
    cardId: key.optional(),
    activityId: key.optional(),
    category: z.string(),
    comment: z.string().max(16000),
    at: stamp,
    status: z.enum(["open", "resolved"]),
  }),
  preferences: z.object({
    id: z.literal("preferences"),
    newLimit: z.number().int().min(0).max(1000),
    retention: z.number().min(0.7).max(0.99),
    timezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
    rollover: z.number().int().min(0).max(23),
    budgetMinutes: z.number().min(0).max(1440),
    theme: z.enum(["system", "light", "dark"]),
    adaptive: z.boolean(),
    aiConsent: z.boolean(),
    evaluationConsent: z.boolean(),
    burySiblings: z.boolean(),
  }),
} as const;
export function validateRecord(entity: string, value: unknown) {
  const schema = recordSchemas[entity as keyof typeof recordSchemas];
  if (!schema) throw new Error("Unknown record type.");
  schema.parse(value);
}
