/**
 * ---
 * layer: worker/application
 * domain: tracking/pipeline
 * purpose: Контракты фазового конструктора tracking (единственный алгоритм — NextGen).
 *          Каждая фаза — чистая функция payload -> payload; порядок и enable/disable
 *          задаёт манифест (см. @radar/shared DEFAULT_TRACKING_PHASE_MANIFEST).
 * ---
 */
import type {
  H3VectorFlowMap,
  NextGenPhase2Stats,
  NextGenPhase3Stats,
  NextGenSeedTrack,
  NextGenSegment,
  ProfileKinematics,
  ThreatProfile,
  TrackingCandidate,
  TrackingDomainTrack as TrajectoryTrack,
  TrackingPhaseId,
  TrackingPhaseManifest,
  TrackingPhaseManifestEntry,
  TrackingPipelineConfig,
} from "@radar/shared";
import type { NextGenNode } from "@radar/shared";

export type { TrackingPhaseId, TrackingPhaseManifest, TrackingPhaseManifestEntry };

/** Статистика cluster-фазы: сколько кандидатов вошло, сколько узлов сформировано ST-DBSCAN. */
export type TrackingClusterPhaseStats = {
  candidatesIn: number;
  nodesOut: number;
};

const EMPTY_CLUSTER_STATS: TrackingClusterPhaseStats = {
  candidatesIn: 0,
  nodesOut: 0,
};

const EMPTY_PHASE2_STATS: NextGenPhase2Stats = {
  pairsConsidered: 0,
  pairsAccepted: 0,
  pairsRejectedKinematics: 0,
  reliabilityAvg: 0,
  reliabilityP95: 0,
};

const EMPTY_PHASE3_STATS: NextGenPhase3Stats = {
  linksConsidered: 0,
  linksAccepted: 0,
  nodesSeeded: 0,
  rejectGap: 0,
  rejectDistance: 0,
  rejectVelocity: 0,
  rejectCounterFlow: 0,
  rejectTurn: 0,
  rejectKalmanInnovation: 0,
};

/** Мутируемый payload единого прохода фаз (SSOT состояния для одного профиля угрозы). */
export type TrackingPhasePayload = {
  readonly candidates: TrackingCandidate[];
  readonly kin: ProfileKinematics;
  readonly profile: ThreatProfile;
  readonly config: TrackingPipelineConfig;
  /** Открытые треки из БД/текущего прогона — вход join-фазы. */
  readonly seedTracks: readonly NextGenSeedTrack[];
  /** Заполняется cluster-фазой. */
  nodes: NextGenNode[];
  clusterStats: TrackingClusterPhaseStats;
  /** Заполняется field_train-фазой (пары для обучения H3-поля). */
  segments: NextGenSegment[];
  phase2Stats: NextGenPhase2Stats;
  /** Заполняется join-фазой. */
  tracks: TrajectoryTrack[];
  phase3Stats: NextGenPhase3Stats;
};

/** Внешние зависимости, общие для всех фаз одного прогона (run-scoped). */
export type TrackingPhaseDeps = {
  readonly flowMap: H3VectorFlowMap;
};

export interface TrackingPhase {
  readonly id: TrackingPhaseId;
  run(payload: TrackingPhasePayload, deps: TrackingPhaseDeps): TrackingPhasePayload;
}

export function createTrackingPhasePayload(input: {
  candidates: TrackingCandidate[];
  kin: ProfileKinematics;
  profile: ThreatProfile;
  config: TrackingPipelineConfig;
  seedTracks: readonly NextGenSeedTrack[];
}): TrackingPhasePayload {
  return {
    ...input,
    nodes: [],
    clusterStats: EMPTY_CLUSTER_STATS,
    segments: [],
    phase2Stats: EMPTY_PHASE2_STATS,
    tracks: [],
    phase3Stats: EMPTY_PHASE3_STATS,
  };
}
