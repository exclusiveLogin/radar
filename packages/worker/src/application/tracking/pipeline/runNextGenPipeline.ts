/**
 * ---
 * layer: worker/application
 * domain: tracking/pipeline
 * purpose: Единая точка входа сборки треков — заменяет NextGenOrchestrator прямым
 *          вызовом. Публичный контракт (вход/выход) идентичен прежнему
 *          NextGenOrchestrator.buildTracks — переносится только механика вызова фаз.
 * ---
 */
import {
  DEFAULT_TRACKING_STEP_MANIFEST,
  type H3VectorFlowMap,
  type NextGenStep2Stats,
  type NextGenStep3Stats,
  type NextGenSeedTrack,
  type ProfileKinematics,
  type ThreatProfile,
  type TrackingCandidate,
  type TrackingDomainTrack as TrajectoryTrack,
  type TrackingStepManifest,
  type TrackingPipelineConfig,
} from "@radar/shared";
import {
  createTrackingStepPayload,
  type TrackingClusterStepStats,
} from "./trackingStepContracts.js";
import { createTrackingStepRegistry } from "./trackingStepRegistry.js";
import { runTrackingSteps } from "./trackingStepRunner.js";
import { NEXTGEN_TRACKING_STEPS } from "./nextGenSteps.js";

const NEXTGEN_STEP_REGISTRY = createTrackingStepRegistry(NEXTGEN_TRACKING_STEPS);

export function buildTracksViaNextGenPipeline(
  candidates: TrackingCandidate[],
  kin: ProfileKinematics,
  profile: ThreatProfile,
  config: TrackingPipelineConfig,
  flowMap: H3VectorFlowMap,
  seedTracks: readonly NextGenSeedTrack[] = [],
  manifest: TrackingStepManifest = DEFAULT_TRACKING_STEP_MANIFEST,
): {
  tracks: TrajectoryTrack[];
  cluster: TrackingClusterStepStats;
  step2: NextGenStep2Stats;
  step3: NextGenStep3Stats;
} {
  const payload = createTrackingStepPayload({ candidates, kin, profile, config, seedTracks });
  const result = runTrackingSteps(manifest, NEXTGEN_STEP_REGISTRY, payload, { flowMap });
  return {
    tracks: result.tracks,
    cluster: result.clusterStats,
    step2: result.step2Stats,
    step3: result.step3Stats,
  };
}
