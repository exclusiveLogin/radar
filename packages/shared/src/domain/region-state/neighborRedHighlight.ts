import type { StateLevel } from "../../schemas/geo/state-level";

/**
 * Превентивная подсветка соседей красного региона.
 *
 * Правило (SSOT для read-side карты):
 * - подсвечивается только регион БЕЗ собственного статуса — любой свой сигнал,
 *   включая green (явный отбой), приоритетнее соседской подсветки;
 * - достаточно одного красного соседа; источник возвращается, чтобы потребитель
 *   унаследовал его `statusEventAt` и затухание шло синхронно с угрозой.
 */
export function resolveNeighborRedHighlights(
  selfLevelByCode: ReadonlyMap<string, StateLevel>,
  adjacency: Readonly<Record<string, readonly string[]>>,
): Map<string, string> {
  const redCodes = new Set<string>();
  for (const [code, level] of selfLevelByCode) {
    if (level === "red") redCodes.add(code);
  }
  if (redCodes.size === 0) return new Map();

  const highlights = new Map<string, string>();
  for (const [code, neighbors] of Object.entries(adjacency)) {
    if (selfLevelByCode.has(code)) continue;
    const redNeighbor = neighbors.find((neighbor) => redCodes.has(neighbor));
    if (redNeighbor) highlights.set(code, redNeighbor);
  }
  return highlights;
}
