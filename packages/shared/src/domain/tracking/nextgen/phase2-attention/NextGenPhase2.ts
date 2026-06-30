/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/nextgen
 * purpose: Фаза 2 — статистический семпл пар для обучения H3-поля (не заготовки треков).
 * ---
 */

import bearing from "@turf/bearing";
import { haversineDistanceM } from "../../haversine";
import {
  applyFlowAlignment,
  flowAlignmentCos,
  isCounterFlowRejected,
  resolveFlowBearingDeg,
  type FlowAlignmentWeights,
} from "../../flowAlignment";
import type { ProfileKinematics } from "../../profileKinematics";
import type { H3VectorFlowMap } from "../flow-map/H3VectorFlowMap";
import type { NextGenNode } from "../phase1-stdbscan/NextGenPhase1";
import { blendedAlignment } from "../nextgenGravity";

export interface NextGenSegment {
  id: string;
  from: NextGenNode;
  to: NextGenNode;
  /** Мета: суммарная масса пары (диагностика). */
  mass: number;
  /** Cos-вес для розы H3 (max(0, alignment)). */
  vectorWeight: number;
  azimuth: number;
}

export interface NextGenPhase2Stats {
  pairsConsidered: number;
  pairsAccepted: number;
  pairsRejectedKinematics: number;
  reliabilityAvg: number;
  reliabilityP95: number;
}

type PairCompatibility = {
  score: number;
  /** Достоверность кинематики пары: 1 = идеально, 0 = шум. */
  reliability: number;
  rejectedByKinematics: boolean;
};

export class NextGenPhase2 {
  /**
   * Принимает отсортированные по времени ноды.
   * Разбивает на окна, строит матрицу, возвращает жесткие пары (отрезки).
   */
  public static execute(
    nodes: NextGenNode[],
    kin: ProfileKinematics,
    flowMap: H3VectorFlowMap,
    flowWeights: FlowAlignmentWeights,
    rflPenaltyThreshold: number,
  ): { segments: NextGenSegment[]; stats: NextGenPhase2Stats } {
    const segments: NextGenSegment[] = [];
    const acceptedReliability: number[] = [];
    let pairsConsidered = 0;
    let pairsAccepted = 0;
    let pairsRejectedKinematics = 0;
    const sorted = [...nodes].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );

    // Окно пар для обучения H3 — уже link maxGap (3ч × N² убивает worker).
    const pairLearnWindowMs = Math.min(
      kin.maxGapMs,
      Math.max(kin.stdbscanEpsilonTemporalMs * 4, 30 * 60 * 1000),
    );
    const maxSegments = 25_000;
    let segmentCount = 0;

    for (let i = 0; i < sorted.length && segmentCount < maxSegments; i++) {
      const a = sorted[i]!;

      for (let j = i + 1; j < sorted.length && segmentCount < maxSegments; j++) {
        const b = sorted[j]!;
        const dtMs = b.occurredAt.getTime() - a.occurredAt.getTime();
        if (dtMs > pairLearnWindowMs) break;
        pairsConsidered++;

        const compatibility = this.calculateCompatibility(
          a,
          b,
          dtMs,
          kin,
          flowMap,
          flowWeights,
          rflPenaltyThreshold,
        );
        if (!compatibility) continue;
        if (compatibility.rejectedByKinematics) {
          pairsRejectedKinematics++;
          continue;
        }

        const blendedAlign = this.blendedFlowAlignment(a, b, flowMap, flowWeights);
        const vectorWeight = Math.max(0, blendedAlign) * compatibility.reliability;
        const segmentMass = a.mass + b.mass + vectorWeight;
        acceptedReliability.push(compatibility.reliability);

        segments.push({
          id: `${a.eventLocationId}->${b.eventLocationId}`,
          from: a,
          to: b,
          mass: segmentMass,
          vectorWeight,
          azimuth: this.calculateAzimuth(a, b),
        });
        segmentCount++;
        pairsAccepted++;
      }
    }

    return {
      segments,
      stats: {
        pairsConsidered,
        pairsAccepted,
        pairsRejectedKinematics,
        reliabilityAvg: this.average(acceptedReliability),
        reliabilityP95: this.percentile(acceptedReliability, 0.95),
      },
    };
  }

  /**
   * Считает совместимость пары узлов. Возвращает null, если связь физически невозможна.
   * Чем выше score, тем лучше связь.
   */
  private static calculateCompatibility(
    a: NextGenNode,
    b: NextGenNode,
    dtMs: number,
    kin: ProfileKinematics,
    flowMap: H3VectorFlowMap,
    flowWeights: FlowAlignmentWeights,
    rflPenaltyThreshold: number,
  ): PairCompatibility | null {
    if (dtMs <= 0 || dtMs > kin.maxGapMs) return null;

    const dist = haversineDistanceM(a.lat, a.lon, b.lat, b.lon);
    if (dist > kin.maxLinkDistanceM) return null;

    const dtSeconds = dtMs / 1000;
    if (dist / dtSeconds > kin.maxVelocityMs) return null;

    const blendedAlign = this.blendedFlowAlignment(a, b, flowMap, flowWeights);

    // Жёсткий gate: тот же counterFlowRejectCos, что у GNN/greedy
    const flowBearing = resolveFlowBearingDeg(
      a.lat,
      a.lon,
      a.nearestFrontLat,
      a.nearestFrontLon,
      null,
      flowWeights,
    );
    if (flowBearing != null) {
      const geoAlign = flowAlignmentCos(a.lat, a.lon, b.lat, b.lon, flowBearing);
      if (isCounterFlowRejected(geoAlign, flowWeights)) return null;
    }

    if (blendedAlign < rflPenaltyThreshold) return null;

    const kinematics = this.kinematicCorrelation(a, b, dtMs, dist, kin, flowBearing);
    if (!kinematics.accept) {
      return {
        score: 0,
        reliability: 0,
        rejectedByKinematics: true,
      };
    }

    const distScore = 1 - dist / kin.maxLinkDistanceM;
    const timeScore = 1 - dtMs / kin.maxGapMs;
    const baseScore = distScore * 10 + timeScore * 5;

    // γ_ток / γ_против из конфига пайплайна
    return {
      score: applyFlowAlignment(baseScore, blendedAlign, flowWeights) * kinematics.reliability,
      reliability: kinematics.reliability,
      rejectedByKinematics: false,
    };
  }

  /** f_A (фронт→тыл) + H3 эмпирика по реальным шагам — единая формула из nextgenGravity. */
  private static blendedFlowAlignment(
    a: NextGenNode,
    b: NextGenNode,
    flowMap: H3VectorFlowMap,
    flowWeights: FlowAlignmentWeights,
  ): number {
    return blendedAlignment(a, b, flowMap, flowWeights);
  }

  private static calculateAzimuth(a: NextGenNode, b: NextGenNode): number {
    let bDeg = bearing([a.lon, a.lat], [b.lon, b.lat]);
    if (bDeg < 0) bDeg += 360;
    return bDeg;
  }

  /**
   * Кинематический коррелятор пары (radial + cross): суррогат innovation-gate без full Kalman.
   * Отсекает пары, которые формально проходят dist/speed, но физически недостоверны.
   */
  private static kinematicCorrelation(
    a: NextGenNode,
    b: NextGenNode,
    dtMs: number,
    distM: number,
    kin: ProfileKinematics,
    flowBearing: number | null,
  ): { accept: boolean; reliability: number } {
    const dtSec = dtMs / 1000;
    const expectedDistM = Math.min(
      kin.maxLinkDistanceM,
      kin.maxVelocityMs * dtSec * 0.55,
    );
    const sigmaRadialM = Math.max(
      kin.maxLinkDistanceM * 0.08,
      kin.maxVelocityMs * dtSec * 0.35,
      1_200,
    );
    // Асимметрия: «слишком далеко» плохо, «ближе ожидаемого» не штрафуем (не кольцо).
    const radialOvershootM = Math.max(0, distM - expectedDistM);
    const radialMse = (radialOvershootM / sigmaRadialM) ** 2;

    let crossMse = 0;
    if (flowBearing != null) {
      const align = flowAlignmentCos(a.lat, a.lon, b.lat, b.lon, flowBearing);
      const crossResidualM = distM * Math.sqrt(Math.max(0, 1 - align * align));
      const sigmaCrossM = Math.max(sigmaRadialM / Math.max(1, kin.locusAnisotropyRatio), 600);
      crossMse = (crossResidualM / sigmaCrossM) ** 2;
    }

    const mse = radialMse + crossMse;
    if (mse > kin.chi2Threshold) return { accept: false, reliability: 0 };

    const reliability = Math.exp(-0.5 * mse);
    if (reliability < 0.05) return { accept: false, reliability };
    return { accept: true, reliability };
  }

  private static average(values: readonly number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((acc, v) => acc + v, 0) / values.length;
  }

  private static percentile(values: readonly number[], q: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1));
    return sorted[idx] ?? 0;
  }
}
