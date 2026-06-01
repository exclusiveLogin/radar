/**
 * Phase-pipeline v2 (ADR-003): фаза = enrichers[] + policy + trigger.
 * Ingest доставляет raw_messages; фазы маркируют phase_coverage и мержат в накопитель.
 */
import { z } from "zod";

export const enricherIdSchema = z.enum([
  "catalog",
  "rule",
  "llm",
  "dadata",
  "nominatim",
]);
export type EnricherId = z.infer<typeof enricherIdSchema>;

/** Как фаза запускается: eager — после ingest; scheduled — daemon; manual — только явный run. */
export const phaseTriggerSchema = z.enum(["eager", "scheduled", "manual"]);
export type PhaseTrigger = z.infer<typeof phaseTriggerSchema>;

/** @deprecated Используйте phaseTriggerSchema; lazy → scheduled при import. */
export const phaseKindSchema = z.enum(["eager", "lazy"]);
export type PhaseKind = z.infer<typeof phaseKindSchema>;

/** @deprecated Используйте phaseId; оставлено для миграции enrichment_queue. */
export const enrichStageSchema = z.enum(["llm", "dadata", "nominatim"]);
export type EnrichStage = z.infer<typeof enrichStageSchema>;

/** Политика нагрузки и батчинга фазы (SSOT в манифесте → БД). */
export const phasePolicySchema = z.object({
  batchSize: z.number().int().positive().default(100),
  intervalMs: z.number().int().positive().default(60_000),
  concurrency: z.number().int().positive().default(1),
  minIntervalMs: z.number().int().nonnegative().default(0),
  rateLimitPerMinute: z.number().int().positive().optional(),
  /** eager: inline сразу после ingest или через очередь (для тяжёлых LLM). */
  eagerMode: z.enum(["inline", "queue"]).default("queue"),
});
export type PhasePolicy = z.infer<typeof phasePolicySchema>;

export const DEFAULT_PHASE_POLICY: PhasePolicy = phasePolicySchema.parse({});

/** Запись манифеста фазы. */
export const phaseManifestEntrySchema = z.object({
  id: z.string().min(1),
  trigger: phaseTriggerSchema,
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

/** Нормализует legacy-манифест (kind/stage → trigger/policy). */
export function normalizePhaseManifestEntry(raw: Record<string, unknown>): PhaseManifestEntry {
  const id = LEGACY_PHASE_ID_MAP[String(raw.id)] ?? String(raw.id);
  let trigger = raw.trigger as PhaseTrigger | undefined;
  if (!trigger) {
    const kind = raw.kind as string | undefined;
    trigger = kind === "lazy" ? "scheduled" : (kind as PhaseTrigger) ?? "scheduled";
  }
  const policy = phasePolicySchema.parse(raw.policy ?? {});
  const enrichers = z.array(enricherIdSchema).parse(raw.enrichers);
  return phaseManifestEntrySchema.parse({
    id,
    trigger,
    enrichers,
    policy,
    enabled: raw.enabled ?? true,
    order: raw.order ?? 0,
  });
}
