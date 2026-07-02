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
  DEFAULT_TRACKING_PHASE_MANIFEST,
  type H3VectorFlowMap,
  type NextGenPhase2Stats,
  type NextGenPhase3Stats,
  type NextGenSeedTrack,
  type ProfileKinematics,
  type ThreatProfile,
  type TrackingCandidate,
  type TrackingDomainTrack as TrajectoryTrack,
  type TrackingPhaseManifest,
  type TrackingPipelineConfig,
} from "@radar/shared";
import {
  createTrackingPhasePayload,
  type TrackingClusterPhaseStats,
} from "./trackingPhaseContracts.js";
import { createTrackingPhaseRegistry } from "./trackingPhaseRegistry.js";
import { runTrackingPhases } from "./trackingPhaseRunner.js";
import { NEXTGEN_TRACKING_PHASES } from "./nextGenPhases.js";

const NEXTGEN_PHASE_REGISTRY = createTrackingPhaseRegistry(NEXTGEN_TRACKING_PHASES);

export function buildTracksViaNextGenPipeline(
  candidates: TrackingCandidate[],
  kin: ProfileKinematics,
  profile: ThreatProfile,
  config: TrackingPipelineConfig,
  flowMap: H3VectorFlowMap,
  seedTracks: readonly NextGenSeedTrack[] = [],
  manifest: TrackingPhaseManifest = DEFAULT_TRACKING_PHASE_MANIFEST,
): {
  tracks: TrajectoryTrack[];
  cluster: TrackingClusterPhaseStats;
  phase2: NextGenPhase2Stats;
  phase3: NextGenPhase3Stats;
} {
  const payload = createTrackingPhasePayload({ candidates, kin, profile, config, seedTracks });
  const result = runTrackingPhases(manifest, NEXTGEN_PHASE_REGISTRY, payload, { flowMap });
  return {
    tracks: result.tracks,
    cluster: result.clusterStats,
    phase2: result.phase2Stats,
    phase3: result.phase3Stats,
  };
}
