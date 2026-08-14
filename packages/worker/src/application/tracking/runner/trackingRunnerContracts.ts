/**
 * ---
 * layer: worker/application
 * domain: tracking/runner
 * purpose: Типы для tracking-workload на runner platform (Wave 3).
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

/** Phase A = cluster strobe; Phase B = join winners; finalize = close ready strobe. */
export type TrackingRunnerPhase = "cluster" | "join" | "finalize";

export type TrackingRunnerSlice = {
  run: TrackingActiveRun;
  phase: TrackingRunnerPhase;
  strobeId: string;
  /** Event-time среза для seeds / track status. */
  rebuildAt: Date;
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
