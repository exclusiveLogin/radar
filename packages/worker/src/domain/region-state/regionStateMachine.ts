import { STATE_LEVEL_RANK } from "@radar/shared";
import type { StateLevel } from "@radar/shared";

/**
 * Чистый автомат уровня региона. Без побочных эффектов и I/O.
 *
 * Модель (липкая):
 * - явный отбой (incoming green) -> green, держится до новой угрозы;
 * - новая тревога перебивает спокойствие (grey/green) и повышает уровень;
 * - менее острая тревога НЕ понижает текущий alarm-уровень (до отбоя).
 */
export function computeSelfLevel(
  current: StateLevel,
  incoming: StateLevel,
): StateLevel {
  if (incoming === "green") return "green";
  return STATE_LEVEL_RANK[incoming] >= STATE_LEVEL_RANK[current]
    ? incoming
    : current;
}

export type EffectiveLevel = { level: StateLevel; reason: string };

/**
 * Эффективный уровень с учётом соседей: красный сосед даёт превентивный yellow.
 * Собственный уровень имеет приоритет, если он не ниже превентивного.
 */
export function computeEffectiveLevel(
  selfLevel: StateLevel,
  neighborSelfLevels: StateLevel[],
): EffectiveLevel {
  const hasRedNeighbor = neighborSelfLevels.includes("red");
  const boost: StateLevel = hasRedNeighbor ? "yellow" : "grey";
  if (STATE_LEVEL_RANK[selfLevel] >= STATE_LEVEL_RANK[boost]) {
    return { level: selfLevel, reason: `self:${selfLevel}` };
  }
  return { level: boost, reason: "neighbor-red" };
}
