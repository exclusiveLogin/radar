/**
 * Geo enrichment artifact: mutable context passed through all pipeline steps.
 * Each step writes its own namespace key; later steps (and the finalizer) may
 * read any already-populated namespace.
 */
import { z } from "zod";
import { eventLocationSchema } from "../ingest/event-location";
import { eventSubjectSchema } from "../ingest/event-type";

// ─── per-step namespace schemas ────────────────────────────────────────────

const geoNodeSchema = z.object({
  name: z.string(),
  kind: z.enum(["region", "district", "city", "locality", "settlement"]),
  regionCode: z.string().optional(),
  fiasId: z.string().optional(),
  lat: z.number().finite().optional(),
  lon: z.number().finite().optional(),
  confidence: z.number().min(0).max(1).optional(),
  /** Краткое обоснование привязки (per-place reason от LLM). */
  reason: z.string().optional(),
});

/**
 * Семантическая группа события по версии LLM (не «умный регэксп», а классификация).
 * Захватывается как сигнал/метаданные; не подменяет правило-классификатор.
 */
export const geoEventCategorySchema = z.enum([
  "threat",
  "impact",
  "all_clear",
  "movement",
  "fixation",
  "pvo_work",
  "intercept",
  "danger",
  "rocket_threat",
  "warning",
  "attention",
  "cleared",
  "noise",
  "other",
]);
export type GeoEventCategory = z.infer<typeof geoEventCategorySchema>;

export const geoEnrichmentCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  regions: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      fiasId: z.string().optional(),
    }),
  ),
  places: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["district", "city", "locality", "settlement"]),
      regionCode: z.string().optional(),
      lat: z.number().finite().optional(),
      lon: z.number().finite().optional(),
    }),
  ),
});

export const geoEnrichmentLlmSchema = z.object({
  schemaVersion: z.literal(1),
  nodes: z.array(geoNodeSchema),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  /** Семантическая группа события (опциональный сигнал LLM). */
  eventCategory: geoEventCategorySchema.optional(),
  /** Субъект угрозы по версии LLM (опциональный сигнал). */
  eventSubject: eventSubjectSchema.optional(),
});

export const geoEnrichmentDadataSchema = z.object({
  schemaVersion: z.literal(1),
  cacheHit: z.boolean(),
  nodes: z.array(geoNodeSchema),
});

export const geoEnrichmentNominatimSchema = z.object({
  schemaVersion: z.literal(1),
  cacheHit: z.boolean(),
  nodes: z.array(geoNodeSchema),
});

/** Вердикт LLM Validator по уже существующему candidate.id (не re-geocoding). */
export const llmValidatorVerdictSchema = z.object({
  candidateId: z.string().min(1),
  verdict: z.enum(["confirm", "reject"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(400).optional(),
});

export const geoEnrichmentLlmValidatorSchema = z.object({
  schemaVersion: z.literal(1),
  verdicts: z.array(llmValidatorVerdictSchema),
  /** Почему вызов пропущен (trigger=off / нет borderline / LLM disabled). */
  skippedReason: z.string().optional(),
});

/** SSOT: метка источника geo в finalizer и parse report. */
export const geoEnrichmentSourceSchema = z.enum([
  "local",
  "cache",
  "dadata",
  "nominatim",
  "llm",
  "llm-validator",
  "multi",
]);

export const geoEnrichmentFinalizerSchema = z.object({
  schemaVersion: z.literal(1),
  regions: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      fiasId: z.string().optional(),
    }),
  ),
  places: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["district", "city", "locality", "settlement"]),
      fiasId: z.string().optional(),
      lat: z.number().finite().optional(),
      lon: z.number().finite().optional(),
    }),
  ),
  precision: z.enum(["unknown", "region", "district", "locality", "locality_with_coords"]),
  completeness: z.number().min(0).max(1),
  source: geoEnrichmentSourceSchema,
});

// ─── top-level artifact ────────────────────────────────────────────────────

export const geoEnrichmentArtifactSchema = z.object({
  catalog: geoEnrichmentCatalogSchema.optional(),
  llm: geoEnrichmentLlmSchema.optional(),
  llmValidator: geoEnrichmentLlmValidatorSchema.optional(),
  dadata: geoEnrichmentDadataSchema.optional(),
  nominatim: geoEnrichmentNominatimSchema.optional(),
  finalizer: geoEnrichmentFinalizerSchema.optional(),
});

/** Snapshot geo-состояния между фазами (persist в mat_parse_event.extras.geoArtifact). */
export const geoEnrichmentStateSchema = geoEnrichmentArtifactSchema.extend({
  validatedLocations: z.array(eventLocationSchema).optional(),
  phaseId: z.string().optional(),
  updatedAt: z.string().optional(),
});

// ─── pipeline trace ────────────────────────────────────────────────────────

export const geoPipelineStepLogSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  skipped: z.boolean().optional(),
  durationMs: z.number().nonnegative().optional(),
});

export const geoPipelineReportSchema = z.object({
  steps: z.array(geoPipelineStepLogSchema),
});

// ─── types ─────────────────────────────────────────────────────────────────

export type GeoNode = z.infer<typeof geoNodeSchema>;
export type GeoEnrichmentArtifact = z.infer<typeof geoEnrichmentArtifactSchema>;
export type GeoEnrichmentState = z.infer<typeof geoEnrichmentStateSchema>;
export type GeoEnrichmentCatalog = z.infer<typeof geoEnrichmentCatalogSchema>;
export type GeoEnrichmentLlm = z.infer<typeof geoEnrichmentLlmSchema>;
export type GeoEnrichmentDadata = z.infer<typeof geoEnrichmentDadataSchema>;
export type GeoEnrichmentNominatim = z.infer<typeof geoEnrichmentNominatimSchema>;
export type LlmValidatorVerdict = z.infer<typeof llmValidatorVerdictSchema>;
export type GeoEnrichmentLlmValidator = z.infer<typeof geoEnrichmentLlmValidatorSchema>;
export type GeoEnrichmentFinalizer = z.infer<typeof geoEnrichmentFinalizerSchema>;
export type GeoPipelineReport = z.infer<typeof geoPipelineReportSchema>;
