/**
 * Geo enrichment artifact: mutable context passed through all pipeline steps.
 * Each step writes its own namespace key; later steps (and the finalizer) may
 * read any already-populated namespace.
 */
import { z } from "zod";

// ─── per-step namespace schemas ────────────────────────────────────────────

const geoNodeSchema = z.object({
  name: z.string(),
  kind: z.enum(["region", "district", "city", "locality", "settlement"]),
  regionCode: z.string().optional(),
  fiasId: z.string().optional(),
  lat: z.number().finite().optional(),
  lon: z.number().finite().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

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
  source: z.enum(["local", "cache", "dadata", "nominatim", "llm", "multi"]),
});

// ─── top-level artifact ────────────────────────────────────────────────────

export const geoEnrichmentArtifactSchema = z.object({
  catalog: geoEnrichmentCatalogSchema.optional(),
  llm: geoEnrichmentLlmSchema.optional(),
  dadata: geoEnrichmentDadataSchema.optional(),
  nominatim: geoEnrichmentNominatimSchema.optional(),
  finalizer: geoEnrichmentFinalizerSchema.optional(),
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
export type GeoEnrichmentCatalog = z.infer<typeof geoEnrichmentCatalogSchema>;
export type GeoEnrichmentLlm = z.infer<typeof geoEnrichmentLlmSchema>;
export type GeoEnrichmentDadata = z.infer<typeof geoEnrichmentDadataSchema>;
export type GeoEnrichmentNominatim = z.infer<typeof geoEnrichmentNominatimSchema>;
export type GeoEnrichmentFinalizer = z.infer<typeof geoEnrichmentFinalizerSchema>;
export type GeoPipelineReport = z.infer<typeof geoPipelineReportSchema>;
