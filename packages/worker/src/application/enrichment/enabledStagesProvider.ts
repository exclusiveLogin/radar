import type { EnrichStage, IPhaseDefinitionRepository } from "@radar/shared";

const DEFAULT_TTL_MS = 30_000;

/**
 * Провайдер включённых lazy-stage'ей из `phase_definitions` с TTL-кэшем.
 * Кэш сглаживает чтение БД в горячем пути eager-подписчика; админ-тумблер
 * `enabled` применяется в пределах TTL без рестарта воркера.
 */
export function createEnabledStagesProvider(
  phaseDefinitions: IPhaseDefinitionRepository,
  ttlMs = DEFAULT_TTL_MS,
): () => Promise<EnrichStage[]> {
  let cached: EnrichStage[] = [];
  let loadedAt = 0;

  return async () => {
    const now = Date.now();
    if (now - loadedAt < ttlMs) return cached;

    const lazyPhases = await phaseDefinitions.listEnabled("lazy");
    cached = lazyPhases
      .map((phase) => phase.stage)
      .filter((stage): stage is EnrichStage => Boolean(stage));
    loadedAt = now;
    return cached;
  };
}
