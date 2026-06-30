/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/nextgen
 * purpose: SSOT весов рёбер и гравитации NextGen. Одна формула стоимости связи
 *          для Фазы 3 (сборка магистралей) и Фазы 4 (переподключение сателлитов).
 * ---
 */
import { haversineDistanceM } from "../haversine";
import {
  applyFlowAlignment,
  bearingDeg,
  flowAlignmentCos,
  isCounterFlowRejected,
  resolveFlowBearingDeg,
  type FlowAlignmentWeights,
} from "../flowAlignment";
import type { ProfileKinematics } from "../profileKinematics";
import type { H3VectorFlowMap } from "./flow-map/H3VectorFlowMap";

/** Минимальная гео-точка для оценки связи (фронт нужен для тока f_A). */
export interface FlowPoint {
  lat: number;
  lon: number;
  occurredAt: Date;
  nearestFrontLat?: number | null;
  nearestFrontLon?: number | null;
}

/** Результат оценки ребра A→B. Чем меньше cost, тем притягательнее связь. */
export interface LinkEvaluation {
  /** Полная стоимость прохода (после штрафа противотока и скидки за гравитацию). */
  cost: number;
  /** cos∠(шаг, ток) ∈ [-1,1]: H3-консенсус + гео-ток фронт→тыл. */
  alignment: number;
}

/** Доля скидки стоимости в самом «тяжёлом» коридоре (cellStrength=1). */
const MAX_GRAVITY_DISCOUNT = 0.5;
/** Вклад H3-консенсуса против гео-тока фронт→тыл при их смешивании. */
const H3_BLEND = 0.45;

/** Кинематическая гладкость трассы: штраф за поворот относительно курса. */
export interface TurnPenaltyConfig {
  /** Множитель стоимости при развороте на 180° (0 = поворот бесплатен). */
  penaltyWeight: number;
  /** Жёсткий запрет поворота круче этого (град): шаг назад по курсу = разрыв. */
  maxTurnDeg: number;
}

export const DEFAULT_TURN_PENALTY: TurnPenaltyConfig = {
  penaltyWeight: 3,
  maxTurnDeg: 135,
};

/** Угловое расхождение двух азимутов ∈ [0,180]. */
function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * cos∠ между шагом A→B и согласованным током: гео-ток фронт→тыл (f_A) смешан
 * с H3-консенсусом ячейки. Если фронт неизвестен — только H3.
 */
export function blendedAlignment(
  a: FlowPoint,
  b: FlowPoint,
  flowMap: H3VectorFlowMap,
  weights: FlowAlignmentWeights,
): number {
  const h3Align = flowMap.getFlowAlignment(a.lat, a.lon, b.lat, b.lon);
  const flowBearing = resolveFlowBearingDeg(
    a.lat,
    a.lon,
    a.nearestFrontLat,
    a.nearestFrontLon,
    null,
    weights,
  );
  if (flowBearing == null) return h3Align;
  const geoAlign = flowAlignmentCos(a.lat, a.lon, b.lat, b.lon, flowBearing);
  return (1 - H3_BLEND) * geoAlign + H3_BLEND * h3Align;
}

/**
 * Оценивает ребро A→B. Возвращает null, если связь физически невозможна
 * (вне кинематики), отклонена gate противотока или это почти-разворот трассы.
 *
 * @param incomingBearingDeg курс трассы, входящий в A (для штрафа за поворот).
 *        null/undefined — A это начало трассы, поворот не штрафуется.
 */
export function evaluateLink(
  a: FlowPoint,
  b: FlowPoint,
  kin: ProfileKinematics,
  flowMap: H3VectorFlowMap,
  weights: FlowAlignmentWeights,
  incomingBearingDeg?: number | null,
  turn: TurnPenaltyConfig = DEFAULT_TURN_PENALTY,
): LinkEvaluation | null {
  const dtMs = b.occurredAt.getTime() - a.occurredAt.getTime();
  if (dtMs <= 0 || dtMs > kin.maxGapMs) return null;

  const dist = haversineDistanceM(a.lat, a.lon, b.lat, b.lon);
  if (dist > kin.maxLinkDistanceM) return null;
  if (dist / (dtMs / 1000) > kin.maxVelocityMs) return null;

  const alignment = blendedAlignment(a, b, flowMap, weights);
  if (isCounterFlowRejected(alignment, weights)) return null;

  // Кинематическая гладкость: резкий поворот трассы дорог, разворот — запрещён.
  const turnFactor = resolveTurnFactor(a, b, incomingBearingDeg, turn);
  if (turnFactor == null) return null;

  // Базовая стоимость: ближе и быстрее = дешевле (0..2).
  const baseCost = dist / kin.maxLinkDistanceM + dtMs / kin.maxGapMs;
  // Штраф противотока / бонус по току из конфига.
  const flowAdjusted = applyFlowAlignment(baseCost, alignment, weights);
  // Скидка за модуль ячейки целевой точки (магнит по частотности, без cos).
  const strength = Math.max(
    flowMap.cellStrength(b.lat, b.lon),
    flowMap.cellStrength(a.lat, a.lon) * 0.5,
  );
  return {
    cost: flowAdjusted * turnFactor * (1 - MAX_GRAVITY_DISCOUNT * strength),
    alignment,
  };
}

/**
 * Множитель стоимости за поворот относительно входящего курса.
 * null — почти-разворот (> MAX_TURN_DEG): трассу так не тянут.
 * 1 — нет входящего курса (старт) или прямо; растёт с углом поворота.
 */
function resolveTurnFactor(
  a: FlowPoint,
  b: FlowPoint,
  incomingBearingDeg: number | null | undefined,
  turn: TurnPenaltyConfig,
): number | null {
  if (incomingBearingDeg == null) return 1;
  const outgoing = bearingDeg(a.lat, a.lon, b.lat, b.lon);
  const turnDeg = angularDiffDeg(incomingBearingDeg, outgoing);
  if (turnDeg > turn.maxTurnDeg) return null;
  const turnRad = (turnDeg * Math.PI) / 180;
  return 1 + turn.penaltyWeight * ((1 - Math.cos(turnRad)) / 2);
}

/**
 * Гравитационная масса отрезка: насколько он лежит в тяжёлом согласованном
 * коридоре H3. Высокая масса → кандидат в магистраль, низкая → сателлит.
 */
export function segmentGravity(
  a: FlowPoint,
  b: FlowPoint,
  flowMap: H3VectorFlowMap,
): number {
  const align = flowMap.getFlowAlignment(a.lat, a.lon, b.lat, b.lon);
  const moduleStrength = flowMap.cellStrength(b.lat, b.lon);
  return moduleStrength * Math.max(0, align);
}
