/**
 * ---
 * layer: worker/application
 * domain: tracking/runner
 * purpose: Типы для tracking-workload на runner platform (Wave 3).
 *          Runtime: runner-platform (infra.manifest.json runners).
 *          Cursor — снимок state_track_pipeline (enabled/config/watermark/activeRunId);
 *          могут меняться из админки в любой момент, поэтому перечитываются каждый тик — так же,
 *          как это делает существующий legacy-демон.
 * ---
 */
import type {
  FlowMapSnapshot,
  TrackingCandidate,
  TrackingPipelineConfig,
  TrackingRebuildStats,
} from "@radar/shared";
import type { IncrementalBatchResult } from "../trackingRebuildService.js";
import type { TrackingActiveRun, TrackingPipelineState } from "../../../infrastructure/tracking/trackingPipelineStateRepository.js";

export type TrackingCursorSnapshot = TrackingPipelineState;

export type TrackingRunnerSlice = {
  run: TrackingActiveRun;
  strobeId: string;
  finalizeOnly: boolean;
  chunk: TrackingCandidate[];
  window: TrackingCandidate[];
  fullPendingIds: ReadonlySet<string>;
  totalCandidates: number;
  config: TrackingPipelineConfig;
  flowSnapshot: FlowMapSnapshot;
};

export type TrackingRunnerArtifact = {
  runId: string;
  result: IncrementalBatchResult | null;
  stats: Partial<TrackingRebuildStats>;
};
