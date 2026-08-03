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
import { extractContinuationFact } from "./extractContinuationFact.js";
import { listActiveCandidates } from "./parseProcessorContract.js";
import { resolveEventTypeForCandidate } from "./resolveEventTypeForCandidate.js";

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

/** Region facet + кандидаты той же группы (для правильного владельца при нескольких регионах). */
type RegionFacetGroup = {
  facet: EventLocation;
  /** Place-кандидаты, чей place.regionId == facet.regionId, в порядке появления. */
  ownerCandidateIds: string[];
};

/**
 * ADR-012 §8: region facet из place.region_id, если нет region-anchor в winners.
 * Каждый facet привязан только к кандидатам своего региона — сообщение может
 * упоминать места из нескольких регионов одновременно.
 */
async function deriveRegionFacetGroups(
  materialized: EventCandidate[],
  regions: IRegionRepository,
  places: IPlaceRepository,
): Promise<RegionFacetGroup[]> {
  const hasRegionAnchor = materialized.some((c) => c.anchor.kind === "region");
  if (hasRegionAnchor) return [];

  const ownerCandidateIdsByRegionId = new Map<string, string[]>();
  for (const candidate of materialized) {
    if (candidate.anchor.kind !== "place" || !candidate.anchor.placeId) continue;
    const place = await places.findById(candidate.anchor.placeId);
    if (!place || place.trustState === "rejected") continue;
    const owners = ownerCandidateIdsByRegionId.get(place.regionId) ?? [];
    owners.push(candidate.id);
    ownerCandidateIdsByRegionId.set(place.regionId, owners);
  }

  const groups: RegionFacetGroup[] = [];
  for (const [regionId, ownerCandidateIds] of ownerCandidateIdsByRegionId) {
    const region = await regions.findById(regionId);
    if (!region) continue;
    groups.push({
      facet: {
        regionId: region.id,
        regionCode: canonicalRegionCode(region),
        regionFias: region.fiasId,
        placeName: region.name,
        precision: "region",
        entityKind: "region",
        source: "db",
        confidence: 0.85,
      },
      ownerCandidateIds,
    });
  }
  return groups;
}

/** Добавляет региональный raise «сохраняется» к одному local-clear event. */
async function appendContinuationFact(input: {
  workspace: ParseWorkspace;
  candidates: EventCandidate[];
  regions: IRegionRepository;
  locationsByCandidateId: Record<string, EventLocation[]>;
}): Promise<void> {
  const continuation = extractContinuationFact(input.workspace);
  if (!continuation) return;

  const target = input.candidates.find(
    (candidate) =>
      resolveEventTypeForCandidate(candidate, input.workspace) === "cleared"
      && (input.locationsByCandidateId[candidate.id]?.length ?? 0) > 0,
  );
  if (!target) return;

  const region = await input.regions.findByCode(continuation.regionCode);
  if (!region) return;

  input.locationsByCandidateId[target.id]!.push({
    regionId: region.id,
    regionCode: canonicalRegionCode(region),
    ...(region.fiasId ? { regionFias: region.fiasId } : {}),
    placeName: region.name,
    precision: "region",
    entityKind: "region",
    source: "db",
    confidence: 1,
    action: "raise",
    statusCode: continuation.statusCode,
    meta: { continuation: true },
  });
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

  const nonClearCandidates = active.filter(
    (candidate) => resolveEventTypeForCandidate(candidate, input.workspace) !== "cleared",
  );
  const regionFacetGroups = await deriveRegionFacetGroups(
    nonClearCandidates,
    input.regions,
    input.places,
  );
  for (const group of regionFacetGroups) {
    const target = group.ownerCandidateIds.find((id) => (result[id]?.length ?? 0) > 0);
    if (!target) continue;
    const decision = await input.validation.validate(rawText, group.facet, validationBase);
    if (decision.decision === "rejected" || !decision.location) continue;
    result[target] = [...(result[target] ?? []), decision.location];
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

  await appendContinuationFact({
    workspace: input.workspace,
    candidates: active,
    regions: input.regions,
    locationsByCandidateId: result,
  });

  return result;
}
