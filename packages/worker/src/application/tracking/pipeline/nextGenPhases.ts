/**
 * ---
 * layer: worker/application
 * domain: tracking/pipeline
 * purpose: Адаптеры существующего NextGen-алгоритма (shared/domain/tracking/nextgen)
 *          к контракту TrackingPhase. Сам алгоритм не переписывается — только
 *          оборачивается в фазовый конструктор (см. план рефакторинга tracking).
 * ---
 */
import {
  NextGenPhase1,
  NextGenPhase2,
  NextGenPhase3,
  registerNodeMasses,
  registerSegmentFlows,
  resolveNextGenFlowWeights,
  resolveNextGenRflPenaltyThreshold,
  resolveNextGenTurnPenalty,
} from "@radar/shared";
import type { TrackingPhase } from "./trackingPhaseContracts.js";

/** cluster: ST-DBSCAN дедуп кандидатов + регистрация массы узлов в H3-поле. */
export const clusterPhase: TrackingPhase = {
  id: "cluster",
  run(payload, deps) {
    const clusterParams = {
      epsilonSpatialM: payload.kin.stdbscanEpsilonSpatialM,
      epsilonTemporalMs: payload.kin.stdbscanEpsilonTemporalMs,
      minPts: payload.kin.stdbscanMinPts ?? 2,
    };
    const nodes = NextGenPhase1.execute(payload.candidates, clusterParams);
    registerNodeMasses(deps.flowMap, nodes);
    return {
      ...payload,
      nodes,
      clusterStats: { candidatesIn: payload.candidates.length, nodesOut: nodes.length },
    };
  },
};

/**
 * filter: заготовка pair-reliability фильтрации сверх кинематического отсева Ф2.
 * Не реализована в этой волне (identity passthrough) — выключена по умолчанию в манифесте.
 */
export const filterPhase: TrackingPhase = {
  id: "filter",
  run: payload => payload,
};

/** field_train: обучение H3 векторного поля (масса + роза cos-векторов) на парах узлов. */
export const fieldTrainPhase: TrackingPhase = {
  id: "field_train",
  run(payload, deps) {
    const flowWeights = resolveNextGenFlowWeights(payload.config);
    const rflPenaltyThreshold = resolveNextGenRflPenaltyThreshold(payload.config);
    const phase2 = NextGenPhase2.execute(
      payload.nodes,
      payload.kin,
      deps.flowMap,
      flowWeights,
      rflPenaltyThreshold,
    );
    registerSegmentFlows(deps.flowMap, phase2.segments);
    return { ...payload, segments: phase2.segments, phase2Stats: phase2.stats };
  },
};

/** join: хронологическая сборка треков по Kalman-локусу + H3-гравитации. */
export const joinPhase: TrackingPhase = {
  id: "join",
  run(payload, deps) {
    const flowWeights = resolveNextGenFlowWeights(payload.config);
    const turn = resolveNextGenTurnPenalty(payload.config);
    const minBackboneNodes = payload.config.nextgen?.minBackboneNodes ?? 3;
    const phase3 = NextGenPhase3.assemble(
      payload.nodes,
      payload.kin,
      deps.flowMap,
      flowWeights,
      turn,
      payload.profile,
      minBackboneNodes,
      payload.seedTracks,
    );
    return { ...payload, tracks: phase3.tracks, phase3Stats: phase3.stats };
  },
};

/**
 * optimize: заготовка post-join cleanup/refine.
 * Не реализована в этой волне (identity passthrough) — выключена по умолчанию в манифесте.
 */
export const optimizePhase: TrackingPhase = {
  id: "optimize",
  run: payload => payload,
};

export const NEXTGEN_TRACKING_PHASES: readonly TrackingPhase[] = [
  clusterPhase,
  filterPhase,
  fieldTrainPhase,
  joinPhase,
  optimizePhase,
];
