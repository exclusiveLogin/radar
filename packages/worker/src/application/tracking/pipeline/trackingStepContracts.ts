/**
 * ---
 * layer: worker/application
 * domain: tracking/pipeline
 * purpose: Контракты фазового конструктора tracking (единственный алгоритм — NextGen).
 *          Каждая фаза — чистая функция payload -> payload; порядок и enable/disable
 *          задаёт манифест (см. @radar/shared DEFAULT_TRACKING_STEP_MANIFEST).
 * ---
 */
import type {
  H3VectorFlowMap,
  NextGenStep2Stats,
  NextGenStep3Stats,
  NextGenSeedTrack,
  NextGenSegment,
  ProfileKinematics,
  ThreatProfile,
  TrackingCandidate,
  TrackingDomainTrack as TrajectoryTrack,
  TrackingStepId,
  TrackingStepManifest,
  TrackingStepManifestEntry,
  TrackingPipelineConfig,
} from "@radar/shared";
import type { NextGenNode } from "@radar/shared";

export type { TrackingStepId, TrackingStepManifest, TrackingStepManifestEntry };

/** Статистика cluster-фазы: сколько кандидатов вошло, сколько узлов сформировано ST-DBSCAN. */
export type TrackingClusterStepStats = {
  candidatesIn: number;
  nodesOut: number;
};

const EMPTY_CLUSTER_STATS: TrackingClusterStepStats = {
  candidatesIn: 0,
  nodesOut: 0,
};

const EMPTY_PHASE2_STATS: NextGenStep2Stats = {
  pairsConsidered: 0,
  pairsAccepted: 0,
  pairsRejectedKinematics: 0,
  reliabilityAvg: 0,
  reliabilityP95: 0,
};

const EMPTY_PHASE3_STATS: NextGenStep3Stats = {
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
export type TrackingStepPayload = {
  readonly candidates: TrackingCandidate[];
  readonly kin: ProfileKinematics;
  readonly profile: ThreatProfile;
  readonly config: TrackingPipelineConfig;
  /** Открытые треки из БД/текущего прогона — вход join-фазы. */
  readonly seedTracks: readonly NextGenSeedTrack[];
  /** Заполняется cluster-фазой. */
  nodes: NextGenNode[];
  clusterStats: TrackingClusterStepStats;
  /** Заполняется field_train-фазой (пары для обучения H3-поля). */
  segments: NextGenSegment[];
  step2Stats: NextGenStep2Stats;
  /** Заполняется join-фазой. */
  tracks: TrajectoryTrack[];
  step3Stats: NextGenStep3Stats;
};

/** Внешние зависимости, общие для всех фаз одного прогона (run-scoped). */
export type TrackingStepDeps = {
  readonly flowMap: H3VectorFlowMap;
};

export interface TrackingStep {
  readonly id: TrackingStepId;
  run(payload: TrackingStepPayload, deps: TrackingStepDeps): TrackingStepPayload;
}

export function createTrackingStepPayload(input: {
  candidates: TrackingCandidate[];
  kin: ProfileKinematics;
  profile: ThreatProfile;
  config: TrackingPipelineConfig;
  seedTracks: readonly NextGenSeedTrack[];
}): TrackingStepPayload {
  return {
    ...input,
    nodes: [],
    clusterStats: EMPTY_CLUSTER_STATS,
    segments: [],
    step2Stats: EMPTY_PHASE2_STATS,
    tracks: [],
    step3Stats: EMPTY_PHASE3_STATS,
  };
}
