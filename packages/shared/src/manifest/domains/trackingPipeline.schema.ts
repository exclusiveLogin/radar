/**
 * ---
 * layer: shared/manifest
 * domain: tracking
 * purpose: Базовый algorithm config tracking до DB-override из Admin UI.
 * ---
 */
import {
  trackingPipelineConfigSchema,
  type TrackingPipelineConfig,
} from "../../schemas/admin/tracking.js";

export const trackingPipelineManifestSchema = trackingPipelineConfigSchema;

/** Единственный baseline алгоритма: schema defaults, затем manifest/env overlay. */
export const DEFAULT_TRACKING_PIPELINE_MANIFEST: TrackingPipelineConfig =
  trackingPipelineManifestSchema.parse({});

export type TrackingPipelineManifest = TrackingPipelineConfig;
