import type {
  IPhaseDefinitionRepository,
  PhaseDefinitionRecord,
  PhaseScope,
  PhaseTrigger,
} from "@radar/shared";

const DEFAULT_TTL_MS = 30_000;

/** TTL-кэш enabled-фаз по trigger (eager ingest / scheduled daemon). */
export function createEnabledPhasesProvider(
  phaseDefinitions: IPhaseDefinitionRepository,
  trigger?: PhaseTrigger,
  scope: PhaseScope = "ingestParse",
  ttlMs = DEFAULT_TTL_MS,
): () => Promise<PhaseDefinitionRecord[]> {
  let cached: PhaseDefinitionRecord[] = [];
  let loadedAt = 0;

  return async () => {
    const now = Date.now();
    if (now - loadedAt < ttlMs) return cached;
    cached = await phaseDefinitions.listEnabled(trigger, scope);
    loadedAt = now;
    return cached;
  };
}
