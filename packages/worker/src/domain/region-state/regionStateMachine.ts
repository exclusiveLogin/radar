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

// Подсветка соседей красного региона — read-side карты:
// resolveNeighborRedHighlights в @radar/shared.
