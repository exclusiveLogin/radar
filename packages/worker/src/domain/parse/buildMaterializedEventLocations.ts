import type { EventCandidate, EventLocation, IRegionRepository, ParseWorkspace } from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import type { GeoValidationService } from "../../application/parsing/geoValidationService.js";
import { deriveEventLocationsFromCandidate } from "./deriveEventLocationsFromCandidate.js";
import { listActiveCandidates } from "./parseProcessorContract.js";

function countPlaceAnchors(candidates: EventCandidate[]): number {
  return candidates.filter((c) => c.anchor.kind === "place").length;
}

/**
 * derive + GeoValidationService для materialized winners.
 * SSOT place_id на write-line (как v1 validate перед persist).
 */
export async function buildMaterializedEventLocations(input: {
  workspace: ParseWorkspace;
  materializedCandidateIds: string[];
  regions: IRegionRepository;
  geoCatalog?: GeoCatalog;
  validation: GeoValidationService;
}): Promise<Record<string, EventLocation[]>> {
  const idSet = new Set(input.materializedCandidateIds);
  const active = listActiveCandidates(input.workspace).filter((c) => idSet.has(c.id));
  const multiPlaceContext = countPlaceAnchors(listActiveCandidates(input.workspace)) > 1;
  const rawText = input.workspace.groomedText;
  const result: Record<string, EventLocation[]> = {};

  for (const candidate of active) {
    const drafts = await deriveEventLocationsFromCandidate(
      candidate,
      input.regions,
      input.geoCatalog,
      input.workspace,
    );
    if (drafts.length === 0) continue;

    const validated: EventLocation[] = [];
    for (const draft of drafts) {
      const decision = await input.validation.validate(rawText, draft, { multiPlaceContext });
      if (decision.decision === "rejected" || !decision.location) continue;
      validated.push(decision.location);
    }
    if (validated.length > 0) {
      result[candidate.id] = validated;
    }
  }

  return result;
}
