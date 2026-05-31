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
 * Эффективный уровень с учётом соседей.
 *
 * Превентивный yellow от красного соседа применяется ТОЛЬКО к региону без
 * собственного статуса (grey = «нет данных»). Любой собственный сигнал —
 * включая green (явный отбой) — приоритетнее соседской подсветки и не
 * перекрашивается.
 */
export function computeEffectiveLevel(
  selfLevel: StateLevel,
  neighborSelfLevels: StateLevel[],
): EffectiveLevel {
  if (selfLevel !== "grey") {
    return { level: selfLevel, reason: `self:${selfLevel}` };
  }
  const hasRedNeighbor = neighborSelfLevels.includes("red");
  return hasRedNeighbor
    ? { level: "yellow", reason: "neighbor-red" }
    : { level: "grey", reason: "self:grey" };
}
