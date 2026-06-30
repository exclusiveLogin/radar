/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Вес тока и штраф за противоток — мягкий множитель поверх ρ.
 * ---
 */

export type FlowAlignmentWeights = {
  /** γ_ток — бонус за движение по потоку. */
  flowWeight: number;
  /** γ_против — штраф за противоток. */
  counterFlowPenalty: number;
  /**
   * Множитель эмпирического коридора: сила B = count × multiplier.
   * 0 = только гео-ток A; 1 = дефолт (1 проход ≈ половина веса B).
   */
  flowEmpiricalMultiplier: number;
  /**
   * Жёсткий gate против тока: минимально допустимый cos∠(шаг, ток фронт→тыл).
   * Если cos < порога — линк ОТКЛОНЯЕТСЯ (БПЛА не летят обратно к фронту).
   * null/undefined — gate выключен (только мягкий штраф). 0 — резать любой
   * шаг с компонентой к фронту; −0.2 — допускать боковой дрейф вдоль фронта.
   */
  counterFlowRejectCos?: number | null;
  /**
   * Глобальный bias направления (cos): вес мягкого смещения результирующего тока.
   * 0/null — выключено. Работает поверх A(front→rear) и B(corridor), без hard-gate.
   */
  globalDirectionWeight?: number | null;
  /**
   * Глобальный азимут bias (градусы, 0=север, 90=восток). null — выключено.
   * Пример: 45 = на северо-восток (от Украины вглубь РФ в среднем).
   */
  globalDirectionBearingDeg?: number | null;
};

export const DEFAULT_FLOW_ALIGNMENT: FlowAlignmentWeights = {
  flowWeight: 1,
  counterFlowPenalty: 1,
  flowEmpiricalMultiplier: 1,
  counterFlowRejectCos: null,
  globalDirectionWeight: 0,
  globalDirectionBearingDeg: null,
};

/**
 * Жёсткий запрет противотока: шаг направлен к фронту сильнее допустимого.
 * Работает только при заданном пороге и известном токе (alignCos из fA).
 */
export function isCounterFlowRejected(
  alignmentCos: number,
  weights: FlowAlignmentWeights = DEFAULT_FLOW_ALIGNMENT,
): boolean {
  const threshold = weights.counterFlowRejectCos;
  if (threshold == null) return false;
  return alignmentCos < threshold;
}

/** Азимут (градусы, 0=север) от (lat1,lon1) к (lat2,lon2). */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Единичный вектор направления (метры: x=восток, y=север) из азимута. */
export function unitVectorFromBearingDeg(bearing: number): [number, number] {
  const rad = (bearing * Math.PI) / 180;
  return [Math.sin(rad), Math.cos(rad)];
}

/** cos∠ между шагом и током ∈ [-1, 1]. */
export function flowAlignmentCos(
  stepLat1: number,
  stepLon1: number,
  stepLat2: number,
  stepLon2: number,
  flowBearingDeg: number,
): number {
  const stepBearing = bearingDeg(stepLat1, stepLon1, stepLat2, stepLon2);
  const [fx, fy] = unitVectorFromBearingDeg(flowBearingDeg);
  const [sx, sy] = unitVectorFromBearingDeg(stepBearing);
  const dot = fx * sx + fy * sy;
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Ток f_A: от ближайшего фронта к точке (фронт→тыл).
 * Ток f_B: направление коридора (from→to), вес w = saturate(count × multiplier).
 */
export function resolveFlowBearingDeg(
  pointLat: number,
  pointLon: number,
  nearestFrontLat: number | null | undefined,
  nearestFrontLon: number | null | undefined,
  corridor: { count: number; bearingDeg: number } | null,
  weights: FlowAlignmentWeights = DEFAULT_FLOW_ALIGNMENT,
): number | null {
  if (nearestFrontLat == null || nearestFrontLon == null) return null;
  const fA = bearingDeg(nearestFrontLat, nearestFrontLon, pointLat, pointLon);

  const strength = (corridor?.count ?? 0) * Math.max(0, weights.flowEmpiricalMultiplier);
  const [ax, ay] = unitVectorFromBearingDeg(fA);
  let vx = ax;
  let vy = ay;

  if (strength > 0 && corridor != null) {
    const w = strength / (1 + strength);
    const [bx, by] = unitVectorFromBearingDeg(corridor.bearingDeg);
    vx = (1 - w) * vx + w * bx;
    vy = (1 - w) * vy + w * by;
  }

  const globalBearing = weights.globalDirectionBearingDeg;
  const globalWeightRaw = weights.globalDirectionWeight ?? 0;
  const globalWeight = Math.max(0, globalWeightRaw);
  if (globalBearing != null && globalWeight > 0) {
    const wg = globalWeight / (1 + globalWeight);
    const [gx, gy] = unitVectorFromBearingDeg(((globalBearing % 360) + 360) % 360);
    vx = (1 - wg) * vx + wg * gx;
    vy = (1 - wg) * vy + wg * gy;
  }

  const len = Math.hypot(vx, vy);
  if (len < 1e-9) return fA;
  return ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360;
}

/** ρ' = ρ · (1 + γ_против·max(0,−a)) / (1 + γ_ток·max(0,+a)) */
export function applyFlowAlignment(
  rho: number,
  alignmentCos: number,
  weights: FlowAlignmentWeights = DEFAULT_FLOW_ALIGNMENT,
): number {
  const a = alignmentCos;
  const penalty = 1 + weights.counterFlowPenalty * Math.max(0, -a);
  const bonus = 1 + weights.flowWeight * Math.max(0, a);
  return (rho * penalty) / Math.max(bonus, 1e-9);
}
