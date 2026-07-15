/**
 * Phase-pipeline v2 (ADR-003): фаза = enrichers[] + policy + trigger.
 * Ingest доставляет mat_ingest_raw; фазы маркируют job_parse_phase и мержат в накопитель.
 */
import { z } from "zod";
import { radarTopicRoutingKeySchema } from "../../transport/topicCatalog.js";

export const enricherIdSchema = z.enum([
  "catalog",
  "rule",
  "llm",
  "dadata",
  "nominatim",
]);
export type EnricherId = z.infer<typeof enricherIdSchema>;

/** @deprecated Заменён на phaseTriggerModeSchema; сохранён для import/БД. */
export const phaseTriggerSchema = z.enum(["eager", "scheduled", "manual"]);
export type PhaseTrigger = z.infer<typeof phaseTriggerSchema>;

/** Режим пробуждения фазы (ортогонально policy). */
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
  maxAttempts: z.number().int().positive().default(3),
  /** После failed — вернуть в pending до исчерпания maxAttempts. */
  retryFailed: z.boolean().default(true),
});
export type PhasePolicy = z.infer<typeof phasePolicySchema>;

export const DEFAULT_PHASE_POLICY: PhasePolicy = phasePolicySchema.parse({});

export const phaseManifestEntrySchema = z.object({
  id: z.string().min(1),
  triggerMode: phaseTriggerModeSchema.default("both"),
  /** @deprecated — нормализуется в triggerMode при import. */
  trigger: phaseTriggerSchema.optional(),
  scope: phaseScopeSchema.default("ingestParse"),
  enrichers: z.array(enricherIdSchema).min(1),
  policy: phasePolicySchema.default({}),
  enabled: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
});
export type PhaseManifestEntry = z.infer<typeof phaseManifestEntrySchema>;

export const phaseManifestSchema = z.object({
  version: z.literal(1).default(1),
  phases: z.array(phaseManifestEntrySchema).default([]),
});
export type PhaseManifest = z.infer<typeof phaseManifestSchema>;

/** Операционная запись фазы из БД. */
export const phaseDefinitionSchema = phaseManifestEntrySchema.extend({
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

/** Legacy trigger → triggerMode. */
export function legacyTriggerToMode(trigger: PhaseTrigger): PhaseTriggerMode {
  if (trigger === "eager") return "event";
  if (trigger === "manual") return "manual";
  return "both";
}

/** Нормализует legacy-манифест (kind/stage/trigger → triggerMode/policy). */
export function normalizePhaseManifestEntry(raw: Record<string, unknown>): PhaseManifestEntry {
  const id = LEGACY_PHASE_ID_MAP[String(raw.id)] ?? String(raw.id);
  let trigger = raw.trigger as PhaseTrigger | undefined;
  if (!trigger) {
    const kind = raw.kind as string | undefined;
    trigger = kind === "lazy" ? "scheduled" : (kind as PhaseTrigger) ?? "scheduled";
  }
  const triggerMode =
    (raw.triggerMode as PhaseTriggerMode | undefined) ?? legacyTriggerToMode(trigger);
  const policy = phasePolicySchema.parse(raw.policy ?? {});
  const enrichers = z.array(enricherIdSchema).parse(raw.enrichers);
  return phaseManifestEntrySchema.parse({
    id,
    triggerMode,
    trigger,
    scope: raw.scope ?? "ingestParse",
    enrichers,
    policy,
    enabled: raw.enabled ?? true,
    order: raw.order ?? 0,
  });
}
