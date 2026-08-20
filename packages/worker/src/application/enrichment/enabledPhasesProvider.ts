import type {
  IPhaseDefinitionRepository,
  PhaseDefinitionRecord,
  PhaseScope,
  PhaseTriggerMode,
} from "@radar/shared";

const DEFAULT_TTL_MS = 30_000;

/** TTL-кэш enabled-фаз по triggerMode / scope. */
export function createEnabledPhasesProvider(
  phaseDefinitions: IPhaseDefinitionRepository,
  triggerMode?: PhaseTriggerMode,
  scope: PhaseScope = "ingestParse",
  ttlMs = DEFAULT_TTL_MS,
): () => Promise<PhaseDefinitionRecord[]> {
  let cached: PhaseDefinitionRecord[] = [];
  let loadedAt = 0;

  return async () => {
    const now = Date.now();
    if (now - loadedAt < ttlMs) return cached;
    cached = await phaseDefinitions.listEnabled(triggerMode, scope);
    loadedAt = now;
    return cached;
  };
}
