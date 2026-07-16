/**
 * ---
 * layer: worker/application
 * domain: tracking/pipeline
 * purpose: Адаптеры существующего NextGen-алгоритма (shared/domain/tracking/nextgen)
 *          к контракту TrackingStep. Сам алгоритм не переписывается — только
 *          оборачивается в фазовый конструктор (см. план рефакторинга tracking).
 * ---
 */
import {
  NextGenStep1,
  NextGenStep2,
  NextGenStep3,
  registerNodeMasses,
  registerSegmentFlows,
  resolveNextGenFlowWeights,
  resolveNextGenRflPenaltyThreshold,
  resolveNextGenTurnPenalty,
} from "@radar/shared";
import type { TrackingStep } from "./trackingStepContracts.js";

/** cluster: ST-DBSCAN дедуп кандидатов + регистрация массы узлов в H3-поле. */
export const clusterStep: TrackingStep = {
  id: "cluster",
  run(payload, deps) {
    const clusterParams = {
      epsilonSpatialM: payload.kin.stdbscanEpsilonSpatialM,
      epsilonTemporalMs: payload.kin.stdbscanEpsilonTemporalMs,
      minPts: payload.kin.stdbscanMinPts ?? 2,
    };
    const nodes = NextGenStep1.execute(payload.candidates, clusterParams);
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
export const filterStep: TrackingStep = {
  id: "filter",
  run: payload => payload,
};

/** field_train: обучение H3 векторного поля (масса + роза cos-векторов) на парах узлов. */
export const fieldTrainStep: TrackingStep = {
  id: "field_train",
  run(payload, deps) {
    const flowWeights = resolveNextGenFlowWeights(payload.config);
    const rflPenaltyThreshold = resolveNextGenRflPenaltyThreshold(payload.config);
    const phase2 = NextGenStep2.execute(
      payload.nodes,
      payload.kin,
      deps.flowMap,
      flowWeights,
      rflPenaltyThreshold,
    );
    registerSegmentFlows(deps.flowMap, phase2.segments);
    return { ...payload, segments: phase2.segments, step2Stats: phase2.stats };
  },
};

/** join: хронологическая сборка треков по Kalman-локусу + H3-гравитации. */
export const joinStep: TrackingStep = {
  id: "join",
  run(payload, deps) {
    const flowWeights = resolveNextGenFlowWeights(payload.config);
    const turn = resolveNextGenTurnPenalty(payload.config);
    const minBackboneNodes = payload.config.nextgen?.minBackboneNodes ?? 3;
    const phase3 = NextGenStep3.assemble(
      payload.nodes,
      payload.kin,
      deps.flowMap,
      flowWeights,
      turn,
      payload.profile,
      minBackboneNodes,
      payload.seedTracks,
    );
    return { ...payload, tracks: phase3.tracks, step3Stats: phase3.stats };
  },
};

/**
 * optimize: заготовка post-join cleanup/refine.
 * Не реализована в этой волне (identity passthrough) — выключена по умолчанию в манифесте.
 */
export const optimizeStep: TrackingStep = {
  id: "optimize",
  run: payload => payload,
};

export const NEXTGEN_TRACKING_STEPS: readonly TrackingStep[] = [
  clusterStep,
  filterStep,
  fieldTrainStep,
  joinStep,
  optimizeStep,
];
