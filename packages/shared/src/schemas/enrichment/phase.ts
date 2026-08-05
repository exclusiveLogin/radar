/**
 * Phase-pipeline v2 (ADR-003): фаза = enrichers[] + policy + triggerMode.
 * Ingest доставляет mat_ingest_raw; фазы маркируют job_parse_phase и мержат в накопитель.
 */
import { z } from "zod";
import { radarTopicRoutingKeySchema } from "../../transport/topicCatalog.js";
import { DEFAULT_PHASE_TERMINAL_POLICY } from "./phaseTerminalPolicy.js";

export const enricherIdSchema = z.enum([
  "catalog",
  "rule",
  "llm",
  "llm-validator",
  "dadata",
  "nominatim",
]);
export type EnricherId = z.infer<typeof enricherIdSchema>;

/** @deprecated Только для phase_runs.trigger и старых манифестов; фазы — triggerMode. */
export const phaseTriggerSchema = z.enum(["eager", "scheduled", "manual"]);
export type PhaseTrigger = z.infer<typeof phaseTriggerSchema>;

/** Режим пробуждения фазы (ортогонально policy). SSOT в phase_definitions.trigger_mode. */
export const phaseTriggerModeSchema = z.enum(["event", "timeout", "both", "manual"]);
export type PhaseTriggerMode = z.infer<typeof phaseTriggerModeSchema>;

export const phaseScopeSchema = z.enum(["ingestParse", "geoParse"]);
export type PhaseScope = z.infer<typeof phaseScopeSchema>;

/** @deprecated Используйте phaseTriggerSchema; lazy → scheduled при import. */
export const phaseKindSchema = z.enum(["eager", "lazy"]);
export type PhaseKind = z.infer<typeof phaseKindSchema>;

/** @deprecated Используйте phaseId; оставлено для миграции queue_parse_enrichment. */
export const enrichStageSchema = z.enum(["llm", "dadata", "nominatim"]);
export type EnrichStage = z.infer<typeof enrichStageSchema>;

/** Политика нагрузки, батчинга и transport-подписки фазы. */
export const phasePolicySchema = z.object({
  batchSize: z.number().int().positive().default(100),
  intervalMs: z.number().int().positive().default(60_000),
  concurrency: z.number().int().positive().default(1),
  minIntervalMs: z.number().int().nonnegative().default(0),
  rateLimitPerMinute: z.number().int().positive().optional(),
  /** inline — сразу после ingest; queue — через RMQ topic. */
  eagerMode: z.enum(["inline", "queue"]).default("queue"),
  claimOrder: z.enum(["asc", "desc"]).optional(),
  subscribeTopic: radarTopicRoutingKeySchema.optional(),
  publishTopic: radarTopicRoutingKeySchema.optional(),
  /** Максимум попыток claim→handle до terminal failed. */
  maxAttempts: z.number().int().positive().default(DEFAULT_PHASE_TERMINAL_POLICY.maxAttempts),
  /** После failed — вернуть в pending до исчерпания maxAttempts. */
  retryFailed: z.boolean().default(DEFAULT_PHASE_TERMINAL_POLICY.retryFailed),
});
export type PhasePolicy = z.infer<typeof phasePolicySchema>;

export const DEFAULT_PHASE_POLICY: PhasePolicy = phasePolicySchema.parse({});

/** Legacy trigger (манифест/БД) → triggerMode. Только для import/миграции. */
export function legacyTriggerToMode(trigger: PhaseTrigger): PhaseTriggerMode {
  if (trigger === "eager") return "event";
  if (trigger === "manual") return "manual";
  return "both";
}

/** Фаза может будиться по таймеру (timeout или hybrid both). */
export function phaseWakesOnSchedule(mode: PhaseTriggerMode): boolean {
  return mode === "timeout" || mode === "both";
}

/** Фаза будится событием (event или hybrid both). */
export function phaseWakesOnEvent(mode: PhaseTriggerMode): boolean {
  return mode === "event" || mode === "both";
}

const phaseManifestEntryObjectSchema = z.object({
  id: z.string().min(1),
  /** SSOT; если нет — выводится из legacy trigger или both. */
  triggerMode: phaseTriggerModeSchema.optional(),
  /**
   * @deprecated Только import старых JSON; в runtime/БД не хранится.
   * Если задан без triggerMode — нормализуется в triggerMode.
   */
  trigger: phaseTriggerSchema.optional(),
  scope: phaseScopeSchema.default("ingestParse"),
  enrichers: z.array(enricherIdSchema).min(1),
  policy: phasePolicySchema.default({}),
  enabled: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
});

/** Нормализует optional legacy trigger → triggerMode; legacy trigger из ответа убираем. */
export const phaseManifestEntrySchema = phaseManifestEntryObjectSchema.transform((entry) => {
  const triggerMode =
    entry.triggerMode ??
    (entry.trigger !== undefined ? legacyTriggerToMode(entry.trigger) : "both");
  return {
    id: entry.id,
    triggerMode,
    scope: entry.scope,
    enrichers: entry.enrichers,
    policy: entry.policy,
    enabled: entry.enabled,
    order: entry.order,
  };
});

/** Запись фазы в манифесте/БД: только triggerMode (без legacy trigger). */
export type PhaseManifestEntry = {
  id: string;
  triggerMode: PhaseTriggerMode;
  scope: PhaseScope;
  enrichers: EnricherId[];
  policy: PhasePolicy;
  enabled: boolean;
  order: number;
};

export const phaseManifestSchema = z.object({
  version: z.literal(1).default(1),
  phases: z.array(phaseManifestEntrySchema).default([]),
});
export type PhaseManifest = z.infer<typeof phaseManifestSchema>;

/** Операционная запись фазы из БД (без legacy trigger). */
export const phaseDefinitionSchema = z
  .object({
    id: z.string().min(1),
    triggerMode: phaseTriggerModeSchema,
    scope: phaseScopeSchema.default("ingestParse"),
    enrichers: z.array(enricherIdSchema).min(1),
    policy: phasePolicySchema.default({}),
    enabled: z.boolean().default(true),
    order: z.number().int().nonnegative().default(0),
    updatedAt: z.string().optional(),
  });
export type PhaseDefinition = z.infer<typeof phaseDefinitionSchema>;

/** Override селектора только для manual CLI / POST run. */
export const manualRunScopeSchema = z.object({
  limit: z.number().int().positive().optional(),
  fromPostedAt: z.string().optional(),
  toPostedAt: z.string().optional(),
  tail: z.boolean().optional(),
});
export type ManualRunScope = z.infer<typeof manualRunScopeSchema>;

/** Маппинг legacy id фаз при import. */
export const LEGACY_PHASE_ID_MAP: Record<string, string> = {
  parse: "catalog",
  "enrich-llm": "llm",
  "enrich-dadata": "dadata",
  "enrich-nominatim": "nominatim",
};

/**
 * Нормализует legacy-манифест (kind/stage/trigger → triggerMode/policy).
 * Не пишет обратно legacy trigger.
 */
export function normalizePhaseManifestEntry(raw: Record<string, unknown>): PhaseManifestEntry {
  const id = LEGACY_PHASE_ID_MAP[String(raw.id)] ?? String(raw.id);
  const legacyTrigger = raw.trigger as PhaseTrigger | undefined;
  const kind = raw.kind as string | undefined;
  const inferredTrigger: PhaseTrigger =
    legacyTrigger ?? (kind === "lazy" ? "scheduled" : (kind as PhaseTrigger) ?? "scheduled");
  const triggerMode =
    (raw.triggerMode as PhaseTriggerMode | undefined) ?? legacyTriggerToMode(inferredTrigger);
  const policy = phasePolicySchema.parse(raw.policy ?? {});
  const enrichers = z.array(enricherIdSchema).parse(raw.enrichers);
  return phaseManifestEntrySchema.parse({
    id,
    triggerMode,
    scope: raw.scope ?? "ingestParse",
    enrichers,
    policy,
    enabled: raw.enabled ?? true,
    order: raw.order ?? 0,
  });
}
