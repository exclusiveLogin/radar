/**

 * ---

 * layer: shared

 * kind: domain service

 * domain: tracking/nextgen

 * purpose: Оркестратор NextGen Gravity: дедуп → обучение H3 → хронологическая сборка.

 * ---

 */



import type { TrackingCandidate, TrajectoryTrack } from "../types";

import type { TrackingPipelineConfig } from "../../../schemas/admin/tracking";

import { NextGenPhase1 } from "./phase1-stdbscan/NextGenPhase1";

import { NextGenPhase2 } from "./phase2-attention/NextGenPhase2";

import { NextGenPhase3 } from "./phase3-gravity/NextGenPhase3";

import type { H3VectorFlowMap } from "./flow-map/H3VectorFlowMap";

import { registerNodeMasses, registerSegmentFlows } from "./flow-map/registerSegmentFlows";
import type { NextGenSeedTrack } from "./nextgenKalmanLink";

import type { ProfileKinematics } from "../profileKinematics";
import type { NextGenPhase2Stats } from "./phase2-attention/NextGenPhase2";

import {

  resolveNextGenFlowWeights,

  resolveNextGenRflPenaltyThreshold,

  resolveNextGenTurnPenalty,

} from "./resolveNextGenFlowWeights";



export class NextGenOrchestrator {

  constructor(

    private readonly flowMap: H3VectorFlowMap,

    private readonly config: TrackingPipelineConfig

  ) {}



  /**

   * Главный пайплайн сборки треков по алгоритму NextGen.

   */

  public buildTracks(
    candidates: TrackingCandidate[],
    kin: ProfileKinematics,
    profile: import("../types").ThreatProfile,
    seedTracks: readonly NextGenSeedTrack[] = [],
  ): { tracks: TrajectoryTrack[]; phase2: NextGenPhase2Stats } {

    const flowWeights = resolveNextGenFlowWeights(this.config);

    const rflPenaltyThreshold = resolveNextGenRflPenaltyThreshold(this.config);

    const turn = resolveNextGenTurnPenalty(this.config);

    const minBackboneNodes = this.config.nextgen?.minBackboneNodes ?? 3;



    // --- Фаза 1: дедуп (ST-DBSCAN). Узел = одно событие. ---

    const clusterParams = {

      epsilonSpatialM: kin.stdbscanEpsilonSpatialM,

      epsilonTemporalMs: kin.stdbscanEpsilonTemporalMs,

      minPts: kin.stdbscanMinPts ?? 2,

    };

    const nodes = NextGenPhase1.execute(candidates, clusterParams);



    // --- Фаза 2: модуль точек + роза cos-векторов от пар ---

    registerNodeMasses(this.flowMap, nodes);

    const phase2 = NextGenPhase2.execute(

      nodes,

      kin,

      this.flowMap,

      flowWeights,

      rflPenaltyThreshold,
    );



    // --- Обогащение H3-поля (живёт между батчами прогона). ---

    registerSegmentFlows(this.flowMap, phase2.segments);



    // --- Фаза 3: хронологическая сборка по всем нодам Ф1 с учётом H3-весов. ---

    return {
      tracks: NextGenPhase3.assemble(

      nodes,

      kin,

      this.flowMap,

      flowWeights,

      turn,

      profile,

      minBackboneNodes,
      seedTracks,
      ),
      phase2: phase2.stats,
    };

  }

}


