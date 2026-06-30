/**
 * SSOT: веса потока NextGen = те же поля, что GNN/greedy (flowWeight, counterFlowPenalty, …).
 */
import type { TrackingPipelineConfig } from "../../../schemas/admin/tracking";
import {
  DEFAULT_FLOW_ALIGNMENT,
  type FlowAlignmentWeights,
} from "../flowAlignment";
import { DEFAULT_TURN_PENALTY, type TurnPenaltyConfig } from "./nextgenGravity";

export function resolveNextGenFlowWeights(
  config: TrackingPipelineConfig,
): FlowAlignmentWeights {
  return {
    flowWeight: config.flowWeight ?? DEFAULT_FLOW_ALIGNMENT.flowWeight,
    counterFlowPenalty: config.counterFlowPenalty ?? DEFAULT_FLOW_ALIGNMENT.counterFlowPenalty,
    flowEmpiricalMultiplier:
      config.flowEmpiricalMultiplier ?? DEFAULT_FLOW_ALIGNMENT.flowEmpiricalMultiplier,
    counterFlowRejectCos:
      config.counterFlowRejectCos ?? DEFAULT_FLOW_ALIGNMENT.counterFlowRejectCos,
  };
}

/** Порог cos для мягкого gate в Phase2 (ниже — отрезок отбрасывается). */
export function resolveNextGenRflPenaltyThreshold(config: TrackingPipelineConfig): number {
  return (
    config.nextgen?.rflPenaltyThreshold
    ?? config.counterFlowRejectCos
    ?? -0.35
  );
}

/** Кинематическая гладкость трассы (штраф за поворот) из конфига. */
export function resolveNextGenTurnPenalty(config: TrackingPipelineConfig): TurnPenaltyConfig {
  return {
    penaltyWeight: config.nextgen?.turnPenaltyWeight ?? DEFAULT_TURN_PENALTY.penaltyWeight,
    maxTurnDeg: config.nextgen?.maxTurnDeg ?? DEFAULT_TURN_PENALTY.maxTurnDeg,
  };
}
