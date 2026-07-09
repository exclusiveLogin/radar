/**
 * ---
 * layer: worker/application
 * domain: tracking/runner
 * purpose: Типы для tracking-workload на runner platform (Wave 3, за флагом
 *          TRACKING_RUNNER_PLATFORM_ENABLED). Cursor здесь — снимок state_track_pipeline
 *          (enabled/config/watermark/activeRunId), а не только watermark: конфиг и enabled-флаг
 *          могут меняться из админки в любой момент, поэтому перечитываются каждый тик — так же,
 *          как это делает существующий legacy-демон.
 * ---
 */
import type { TrackingCandidate, TrackingPipelineConfig, TrackingRebuildStats } from "@radar/shared";
import type { IncrementalBatchResult } from "../trackingRebuildService.js";
import type { TrackingActiveRun, TrackingPipelineState } from "../../../infrastructure/tracking/trackingPipelineStateRepository.js";

export type TrackingCursorSnapshot = TrackingPipelineState;

export type TrackingRunnerSlice = {
  run: TrackingActiveRun;
  chunk: TrackingCandidate[];
  closure: TrackingCandidate[];
  fullPendingIds: ReadonlySet<string>;
  totalCandidates: number;
  config: TrackingPipelineConfig;
};

export type TrackingRunnerArtifact = {
  runId: string;
  result: IncrementalBatchResult | null;
  stats: Partial<TrackingRebuildStats>;
};
