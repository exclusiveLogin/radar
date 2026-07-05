import type {
  EventCandidate,
  EventLocation,
  IPlaceRepository,
  IRegionRepository,
  ParseWorkspace,
} from "@radar/shared";
import { canonicalRegionCode } from "@radar/shared";
import type { GeoValidationService } from "../../application/parse/geoValidationService.js";
import { applyVicinityScope } from "./applyVicinityScope.js";
import { anchorsFromPlaceCandidates } from "./geo/filterRegionScanHits.js";
import { deriveEventLocationsFromCandidate } from "./deriveEventLocationsFromCandidate.js";
import { listActiveCandidates } from "./parseProcessorContract.js";

function countPlaceAnchors(candidates: EventCandidate[]): number {
  return candidates.filter((c) => c.anchor.kind === "place").length;
}

/** ADR-012: parse материализует только каталог; runtime upsert places запрещён. */
const PARSE_CATALOG_VALIDATION_CTX = { catalogHeal: true } as const;

/** Подтянуть lat/lon из places если anchor пуст. */
async function enrichDraftCoords(
  draft: EventLocation,
  candidate: EventCandidate,
  places: IPlaceRepository,
): Promise<EventLocation> {
  if (draft.lat != null && draft.lon != null) return draft;
  const placeId = draft.placeId ?? candidate.anchor.placeId;
  if (!placeId) return draft;
  const place = await places.findById(placeId);
  if (place?.centroidLat == null || place.centroidLon == null) return draft;
  return { ...draft, lat: place.centroidLat, lon: place.centroidLon };
}

/**
 * ADR-012 §8: region facet из place.region_id, если нет region-anchor в winners.
 */
async function deriveRegionFromPlace(
  materialized: EventCandidate[],
  regions: IRegionRepository,
  places: IPlaceRepository,
): Promise<EventLocation[]> {
  const hasRegionAnchor = materialized.some((c) => c.anchor.kind === "region");
  if (hasRegionAnchor) return [];

  const regionIds = new Set<string>();
  for (const candidate of materialized) {
    if (candidate.anchor.kind !== "place" || !candidate.anchor.placeId) continue;
    const place = await places.findById(candidate.anchor.placeId);
    if (place && place.trustState !== "rejected") regionIds.add(place.regionId);
  }

  const derived: EventLocation[] = [];
  for (const regionId of regionIds) {
    const region = await regions.findById(regionId);
    if (!region) continue;
    derived.push({
      regionId: region.id,
      regionCode: canonicalRegionCode(region),
      regionFias: region.fiasId,
      placeName: region.name,
      precision: "region",
      entityKind: "region",
      source: "db",
      confidence: 0.85,
    });
  }
  return derived;
}

/**
 * derive + GeoValidationService для materialized winners + vicinity scope.
 */
export async function buildMaterializedEventLocations(input: {
  workspace: ParseWorkspace;
  materializedCandidateIds: string[];
  regions: IRegionRepository;
  places: IPlaceRepository;
  validation: GeoValidationService;
}): Promise<Record<string, EventLocation[]>> {
  const idSet = new Set(input.materializedCandidateIds);
  const active = listActiveCandidates(input.workspace).filter((c) => idSet.has(c.id));
  const multiPlaceContext = countPlaceAnchors(listActiveCandidates(input.workspace)) > 1;
  const rawText = input.workspace.groomedText;
  const localityAnchors = anchorsFromPlaceCandidates(listActiveCandidates(input.workspace));
  const validationBase = {
    ...PARSE_CATALOG_VALIDATION_CTX,
    multiPlaceContext,
    localityAnchors,
  };
  const result: Record<string, EventLocation[]> = {};

  for (const candidate of active) {
    const drafts = await deriveEventLocationsFromCandidate(candidate, input.regions);
    if (drafts.length === 0) continue;

    const validated: EventLocation[] = [];
    for (const rawDraft of drafts) {
      const draft = await enrichDraftCoords(rawDraft, candidate, input.places);
      const decision = await input.validation.validate(rawText, draft, validationBase);
      if (decision.decision === "rejected" || !decision.location) continue;
      validated.push(decision.location);
    }
    if (validated.length > 0) {
      result[candidate.id] = validated;
    }
  }

  const regionFacets = await deriveRegionFromPlace(active, input.regions, input.places);
  if (regionFacets.length > 0) {
    const target = active.find((c) => c.anchor.kind === "place" && (result[c.id]?.length ?? 0) > 0);
    if (target) {
      const validatedFacets: EventLocation[] = [];
      for (const draft of regionFacets) {
        const decision = await input.validation.validate(rawText, draft, validationBase);
        if (decision.decision !== "rejected" && decision.location) {
          validatedFacets.push(decision.location);
        }
      }
      if (validatedFacets.length > 0) {
        result[target.id] = [...(result[target.id] ?? []), ...validatedFacets];
      }
    }
  }

  const vicinity = await applyVicinityScope({
    workspace: input.workspace,
    materializedCandidateIds: input.materializedCandidateIds,
    regions: input.regions,
    places: input.places,
  });
  if (vicinity) {
    const existing = result[vicinity.anchorCandidateId] ?? [];
    result[vicinity.anchorCandidateId] = [...existing, vicinity.location];
  }

  return result;
}
