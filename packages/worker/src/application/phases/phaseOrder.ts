import type { PhaseDefinitionRecord } from "@radar/shared";

/** Сортировка фаз по полю order (манифест = последовательность, не параллель). */
export function sortPhasesByOrder(phases: PhaseDefinitionRecord[]): PhaseDefinitionRecord[] {
  return [...phases].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * Фазы с меньшим order должны быть done, прежде чем claim текущей.
 * Eager и scheduled в одной цепочке: catalog → llm → dadata → …
 */
export function prerequisitePhaseIds(
  phase: PhaseDefinitionRecord,
  allEnabled: PhaseDefinitionRecord[],
): string[] {
  return sortPhasesByOrder(allEnabled)
    .filter((p) => p.order < phase.order)
    .map((p) => p.id);
}
