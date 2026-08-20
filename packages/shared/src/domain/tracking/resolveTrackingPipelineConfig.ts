/**
 * ---
 * layer: shared
 * kind: domain service
 * domain: tracking
 * purpose: Единый precedence algorithm config: manifest/env baseline → Admin DB override.
 * ---
 */
import {
  trackingPipelineConfigSchema,
  type TrackingPipelineConfig,
} from "../../schemas/admin/tracking.js";
import { deepMergeJson } from "../../manifest/deepMergeJson.js";

/** DB хранит только пользовательские отличия; все потребители получают полный resolved config. */
export function resolveTrackingPipelineConfig(
  baseline: TrackingPipelineConfig,
  dbOverride: unknown,
): TrackingPipelineConfig {
  const patch = isRecord(dbOverride) ? dbOverride : {};
  return trackingPipelineConfigSchema.parse(deepMergeJson(baseline, patch, {}));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
