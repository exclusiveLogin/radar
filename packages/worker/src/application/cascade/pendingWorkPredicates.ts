/**
 * ---
 * layer: worker/application
 * domain: cascade
 * purpose: Предикаты «есть ли ещё работа» для hasPendingWork перед idle-claim.
 * ---
 */
import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPlaceEnrichmentJobRepository,
  PhaseScope,
  PlaceEnrichmentProvider,
} from "@radar/shared";
import { resolveGeoEnrichmentProvider } from "@radar/shared";

/** Есть pending/processing coverage хотя бы у одной enabled фазы scope. */
export async function hasPendingPhaseCoverageWork(input: {
  phases: IPhaseDefinitionRepository;
  coverage: IPhaseCoverageRepository;
  scope: PhaseScope;
}): Promise<boolean> {
  const enabled = await input.phases.listEnabled(undefined, input.scope);
  for (const phase of enabled) {
    const counts = await input.coverage.countByStatus(phase.id);
    if (counts.pending + counts.processing > 0) return true;
  }
  return false;
}

/** Есть pending/processing place-jobs у любого enabled geo-провайдера. */
export async function hasPendingGeoPlaceWork(input: {
  phases: IPhaseDefinitionRepository;
  placeJobs: IPlaceEnrichmentJobRepository;
}): Promise<boolean> {
  const enabled = await input.phases.listEnabled(undefined, "geoParse");
  const providers = new Set<PlaceEnrichmentProvider>();
  for (const phase of enabled) {
    const provider = resolveGeoEnrichmentProvider(phase);
    if (provider) providers.add(provider);
  }
  for (const provider of providers) {
    const counts = await input.placeJobs.countByStatus(provider);
    if (counts.pending + counts.processing > 0) return true;
  }
  return false;
}
