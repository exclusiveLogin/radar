import type { EnricherId } from "@radar/shared";
import type { PhaseDefinitionRecord } from "@radar/shared";

/** Полный reparse | доработка фазой | heal reconcile. */
export type ParseWorkspaceRunKind = "rebuild" | "phase_enrich" | "heal";

/**
 * Три операционных контура parse — SSOT для комментариев и маршрутизации run().
 *
 * Не путать с FinalizeContext.mode (initial | refinalize | heal) — политика
 * reconcile в terminal finalizer (orphan sweep, candidateEventMap).
 *
 * ## 1. REBUILD (`parse run`, eager catalog ingest)
 * - parsed_events + message_parse_workspace очищены (или первый ingest)
 * - raw → groom → catalog enricher → (optional) enrichers → finalize(mode=initial)
 *
 * ## 2. PHASE_ENRICH (scheduled/manual phase, workspace уже в БД)
 * - load workspace JSONB → run enricher(ы) фазы (без catalog) → finalize(refinalize)
 * - raw/orchestrator не вызываем
 *
 * ## 3. HEAL (`workspace:heal`)
 * - load workspace → только finalizer(mode=heal), без enricher/orchestrator
 * - sync candidateEventMap ↔ spawnedEventIds, orphan sweep
 */

/** Enricher-ы фазы без catalog (catalog уже в сохранённом workspace). */
export function phaseEnrichersToRun(enrichers: EnricherId[]): EnricherId[] {
  return enrichers.filter((id) => id !== "catalog");
}

/**
 * rebuild: eager catalog или полный reparse.
 * phase_enrich: scheduled/manual фаза с llm/dadata/… (workspace должен существовать).
 */
export function resolvePhaseRunKind(phase: PhaseDefinitionRecord): ParseWorkspaceRunKind {
  const lazy = phaseEnrichersToRun(phase.enrichers);
  if (lazy.length > 0 && phase.trigger !== "eager") {
    return "phase_enrich";
  }
  return "rebuild";
}
