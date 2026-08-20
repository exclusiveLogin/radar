/**
 * ---
 * layer: shared/domain
 * domain: tracking/nextgen
 * purpose: SSOT состава steps NextGen step-constructor (id + enabled).
 *          Worker (pipeline) и API (admin UI) — без дублирования списка.
 * ---
 */

/** Базовые блоки NextGen step-constructor (см. docs/sdd/tracking). */
export type TrackingStepId = "cluster" | "filter" | "field_train" | "join" | "optimize";

export type TrackingStepManifestEntry = {
  readonly id: TrackingStepId;
  readonly enabled: boolean;
};

/** Порядок и включённость steps — единственное место, где это решается. */
export type TrackingStepManifest = readonly TrackingStepManifestEntry[];

export const DEFAULT_TRACKING_STEP_MANIFEST: TrackingStepManifest = [
  { id: "cluster", enabled: true },
  { id: "filter", enabled: false },
  { id: "field_train", enabled: true },
  { id: "join", enabled: true },
  { id: "optimize", enabled: false },
];