/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Жадная ассоциация по току — соединение пар точек в цепочки с монотонной
 *          глубиной (front_distance) и приоритетом движения вглубь страны.
 * ---
 *
 * Идея (альтернатива GNN/Kalman): инкрементально по времени каждая точка проходит
 * self-attention к хвостам (последним точкам) всех открытых треков и поглощается
 * ближайшим по стоимости (argmin), иначе сидирует новый трек. Инварианты ребра:
 *   • t_j > t_tail                      — поздняя точка позже хвоста;
 *   • depth_j ≥ depth_tail − ε          — течёт вглубь (противоток к фронту запрещён);
 *   • dist ≤ R, dt ≤ gap, v ≤ v_max     — физический радиус и скорость;
 * cost = dist·w_SA + dt·w_dt − align·w_flow; w_SA (distWeightM) — вес близости к
 * последней точке трека, поэтому точку забирает БЛИЖАЙШИЙ трек, а не первый любой.
 */
import {
  applyMagnetWeights,
  DEFAULT_MAGNET_COST_WEIGHTS,
  EMPTY_MAGNETISM_INDEX,
  type MagnetCostWeights,
  type MagnetismIndex,
} from "./applyMagnetWeights";
import { bearingDeg, flowAlignmentCos } from "./flowAlignment";
import { haversineDistanceM } from "./haversine";
import type { ProfileKinematics } from "./profileKinematics";
import type { TrackingCandidate } from "./types";

/** Веса и допуски жадной ассоциации. */
export type GreedyFlowWeights = {
  /** Self-attention: вес расстояния (м) до последней точки трека (ближайший поглощает). */
  distWeightM: number;
  /** Штраф за час разрыва (метров-эквивалент на 1 ч). */
  dtPenaltyPerHourM: number;
  /** Награда за совпадение с током (метров-эквивалент при align=1). */
  flowAlignRewardM: number;
  /** Допуск «не глубже» (м): шаг к фронту разрешён не более чем на ε. */
  depthToleranceM: number;
  /**
   * Жёсткий gate против тока: мин. допустимый cos∠(шаг, ток). null — выкл.
   * Дублирует семантику FlowAlignmentWeights.counterFlowRejectCos для greedy-пути.
   */
  counterFlowRejectCos: number | null;
};

export const DEFAULT_GREEDY_FLOW: GreedyFlowWeights = {
  distWeightM: 1,
  dtPenaltyPerHourM: 20_000,
  flowAlignRewardM: 50_000,
  depthToleranceM: 20_000,
  counterFlowRejectCos: -0.2,
};

/**
 * Глубина точки от фронта (м): непрерывный градиент front_distance_km,
 * с геометрическим фолбэком до ближайшего фронт-центроида (100% покрытие).
 */
export function depthFromFrontM(candidate: TrackingCandidate): number {
  if (candidate.frontDistanceKm != null) return candidate.frontDistanceKm * 1000;
  if (candidate.nearestFrontLat != null && candidate.nearestFrontLon != null) {
    return haversineDistanceM(
      candidate.lat,
      candidate.lon,
      candidate.nearestFrontLat,
      candidate.nearestFrontLon,
    );
  }
  return 0;
}

/** Ток f_A в точке: азимут от ближайшего фронта к точке (фронт→тыл). */
function flowBearingAt(candidate: TrackingCandidate): number | null {
  if (candidate.nearestFrontLat == null || candidate.nearestFrontLon == null) return null;
  return bearingDeg(candidate.nearestFrontLat, candidate.nearestFrontLon, candidate.lat, candidate.lon);
}

/** Открытый трек в процессе построения: цепочка + кэш хвоста. */
type OpenChain = {
  chain: TrackingCandidate[];
  tailMs: number;
  tailDepth: number;
};

/**
 * Строит цепочки точек (≥2) инкрементальным self-attention по току.
 * Каждая точка по времени поглощается ближайшим (argmin cost) открытым треком,
 * иначе сидирует новый. Возвращает цепочки в порядке времени — заготовки треков.
 */
export type GreedyFlowOpts = {
  weights?: GreedyFlowWeights;
  magnetismIndex?: MagnetismIndex;
  magnetCost?: MagnetCostWeights;
};

export function buildGreedyFlowChains(
  candidates: TrackingCandidate[],
  kin: ProfileKinematics,
  opts: GreedyFlowOpts | GreedyFlowWeights = DEFAULT_GREEDY_FLOW,
): TrackingCandidate[][] {
  const resolved: GreedyFlowOpts =
    "distWeightM" in opts ? { weights: opts } : opts;
  const weights = resolved.weights ?? DEFAULT_GREEDY_FLOW;
  const magnetismIndex = resolved.magnetismIndex ?? EMPTY_MAGNETISM_INDEX;
  const magnetCost = resolved.magnetCost ?? DEFAULT_MAGNET_COST_WEIGHTS;
  const pts = [...candidates].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.eventLocationId.localeCompare(b.eventLocationId),
  );
  if (pts.length < 2) return [];

  const chains: TrackingCandidate[][] = [];
  let open: OpenChain[] = [];

  for (const pt of pts) {
    const tj = pt.occurredAt.getTime();
    const depthJ = depthFromFrontM(pt);

    // Закрываем треки, чей хвост старше окна gap (будущие точки только позже).
    const stillOpen: OpenChain[] = [];
    for (const tr of open) {
      if (tj - tr.tailMs > kin.maxGapMs) {
        if (tr.chain.length >= 2) chains.push(tr.chain);
      } else {
        stillOpen.push(tr);
      }
    }
    open = stillOpen;

    // Self-attention: ближайший по стоимости хвост поглощает точку.
    let best: OpenChain | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const tr of open) {
      const cost = scoreEdge(
        tr.chain[tr.chain.length - 1]!,
        pt,
        tr.tailDepth,
        depthJ,
        tj - tr.tailMs,
        kin,
        weights,
        magnetismIndex,
        magnetCost,
      );
      if (cost != null && cost < bestCost) {
        bestCost = cost;
        best = tr;
      }
    }

    if (best != null) {
      best.chain.push(pt);
      best.tailMs = tj;
      best.tailDepth = depthJ;
    } else {
      open.push({ chain: [pt], tailMs: tj, tailDepth: depthJ });
    }
  }

  for (const tr of open) {
    if (tr.chain.length >= 2) chains.push(tr.chain);
  }
  return chains;
}

/** Стоимость ребра i→j или null, если инвариант нарушен. */
function scoreEdge(
  from: TrackingCandidate,
  to: TrackingCandidate,
  depthFrom: number,
  depthTo: number,
  dtMs: number,
  kin: ProfileKinematics,
  weights: GreedyFlowWeights,
  magnetismIndex: MagnetismIndex,
  magnetCost: MagnetCostWeights,
): number | null {
  if (dtMs <= 0 || dtMs > kin.maxGapMs) return null;

  const dist = haversineDistanceM(from.lat, from.lon, to.lat, to.lon);
  if (dist > kin.maxLinkDistanceM) return null;

  const dtSeconds = dtMs / 1000;
  if (dist / dtSeconds > kin.maxVelocityMs) return null;

  // Монотонность глубины: поздняя точка должна быть глубже (с допуском ε).
  if (depthTo < depthFrom - weights.depthToleranceM) return null;

  // Совпадение с током (фронт→тыл) в точке назначения.
  const flowB = flowBearingAt(to);
  const align = flowB != null ? flowAlignmentCos(from.lat, from.lon, to.lat, to.lon, flowB) : 0;
  if (flowB != null && weights.counterFlowRejectCos != null && align < weights.counterFlowRejectCos) {
    return null;
  }

  const dtHours = dtMs / 3_600_000;
  const baseCost =
    weights.distWeightM * dist +
    weights.dtPenaltyPerHourM * dtHours -
    weights.flowAlignRewardM * align;
  return applyMagnetWeights(
    baseCost,
    to.eventLocationId,
    magnetismIndex,
    magnetCost,
    align,
  );
}
