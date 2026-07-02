/**
 * ---
 * layer: shared/domain
 * domain: tracking/nextgen
 * purpose: SSOT для состава фаз NextGen phase-constructor (id + enabled).
 *          Используется worker'ом (исполнение пайплайна) и API (отчёт в admin UI,
 *          какие фазы вообще существуют и какие активны) — без дублирования списка.
 *          cluster/field_train/join — ядро алгоритма (выключать бессмысленно вне
 *          полноценной альтернативной реализации). filter/optimize — заготовки под
 *          будущее расширение, выключены по умолчанию (identity passthrough).
 * ---
 */

/** Базовые блоки NextGen phase-constructor (см. docs/sdd/tracking). */
export type TrackingPhaseId = "cluster" | "filter" | "field_train" | "join" | "optimize";

export type TrackingPhaseManifestEntry = {
  readonly id: TrackingPhaseId;
  readonly enabled: boolean;
};

/** Порядок и включённость фаз — единственное место, где это решается. */
export type TrackingPhaseManifest = readonly TrackingPhaseManifestEntry[];

export const DEFAULT_TRACKING_PHASE_MANIFEST: TrackingPhaseManifest = [
  { id: "cluster", enabled: true },
  { id: "filter", enabled: false },
  { id: "field_train", enabled: true },
  { id: "join", enabled: true },
  { id: "optimize", enabled: false },
];
