/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: SSOT — единая весовая модель магнетизма для всех алгоритмов ассоциации.
 * ---
 */
import type { MagnetismEntry } from "./stdbscan/stdbscanMagnetize";

export type MagnetCostWeights = {
  /** Вес магнетизма точки в делителе cost. */
  wMag: number;
  /** Доп. вес forward-align в делителе (поверх flow в baseCost). */
  wFlow: number;
};

export const DEFAULT_MAGNET_COST_WEIGHTS: MagnetCostWeights = {
  wMag: 1,
  wFlow: 0,
};

export type MagnetismIndex = Map<string, MagnetismEntry>;

export const EMPTY_MAGNETISM_INDEX: MagnetismIndex = new Map();

/**
 * Применяет магнитный и flow-множитель к базовой стоимости ребра.
 * finalCost = baseCost / (1 + wMag·m) / (1 + wFlow·align⁺)
 */
export function applyMagnetWeights(
  baseCost: number,
  targetEventLocationId: string,
  magnetismIndex: MagnetismIndex | undefined,
  weights: MagnetCostWeights,
  forwardAlign = 0,
): number {
  if (baseCost <= 0 || !Number.isFinite(baseCost)) return baseCost;
  const entry = magnetismIndex?.get(targetEventLocationId);
  const m = entry?.magnetism ?? 0;
  const alignPos = Math.max(0, forwardAlign);
  const magDiv = 1 + weights.wMag * Math.max(0, m);
  const flowDiv = 1 + weights.wFlow * alignPos;
  return baseCost / magDiv / flowDiv;
}

/** Магнетизм точки из индекса (0 если нет записи). */
export function magnetismOf(
  eventLocationId: string,
  magnetismIndex: MagnetismIndex | undefined,
): number {
  return magnetismIndex?.get(eventLocationId)?.magnetism ?? 0;
}
