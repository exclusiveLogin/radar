import type { EventCandidate, EventLocation, IRegionRepository, ParseWorkspace, RegionRecord } from "@radar/shared";
import {
  canonicalRegionCode,
  normalizeRegionCodeAlias,
} from "@radar/shared";
import { listActiveCandidates } from "./parseProcessorContract.js";

/** regionCode для anchor: явный на candidate → normalize. */
function resolveAnchorRegionCode(candidate: EventCandidate): string | undefined {
  const onAnchor = candidate.anchor.regionCode?.trim();
  if (!onAnchor) return undefined;
  return normalizeRegionCodeAlias(onAnchor);
}

/** Резолв region row по anchor candidate (code на anchor). */
async function resolveRegionForCandidate(
  regions: IRegionRepository,
  candidate: EventCandidate,
): Promise<RegionRecord | null> {
  const code = resolveAnchorRegionCode(candidate);
  if (code) {
    const byCode = await regions.findByCode(code);
    if (byCode) return byCode;
  }

  const name = candidate.anchor.name?.trim();
  if (name && candidate.anchor.kind === "region") {
    const byName = await regions.findByCode(name);
    if (byName) return byName;
  }

  return null;
}

/** Проекция anchor candidate → EventLocation[] с region_id из БД. */
export async function deriveEventLocationsFromCandidate(
  candidate: EventCandidate,
  regions: IRegionRepository,
): Promise<EventLocation[]> {
  if (candidate.anchor.kind === "system") {
    return [];
  }

  const region = await resolveRegionForCandidate(regions, candidate);
  if (!region) {
    return [];
  }

  const source: EventLocation["source"] =
    candidate.authorEnricherId === "llm" ? "llm" : "db";

  if (candidate.anchor.kind === "region") {
    return [
      {
        regionId: region.id,
        regionCode: canonicalRegionCode(region),
        regionFias: region.fiasId ?? candidate.anchor.placeFias,
        placeName: candidate.anchor.name,
        placeId: candidate.anchor.placeId,
        precision: "region",
        entityKind: "region",
        source,
        confidence: candidate.trust / 100,
      },
    ];
  }

  return [
    {
      regionId: region.id,
      regionCode: canonicalRegionCode(region),
      placeId: candidate.anchor.placeId,
      placeName: candidate.anchor.name,
      placeFias: candidate.anchor.placeFias,
      lat: candidate.anchor.lat,
      lon: candidate.anchor.lon,
      precision: "city",
      entityKind: "place",
      source,
      confidence: candidate.trust / 100,
    },
  ];
}

/** Локации для materialized candidates (region_id из regions table). */
export async function buildLocationsByCandidateId(
  workspace: ParseWorkspace,
  regions: IRegionRepository,
): Promise<Record<string, EventLocation[]>> {
  const result: Record<string, EventLocation[]> = {};
  for (const candidate of listActiveCandidates(workspace)) {
    const locations = await deriveEventLocationsFromCandidate(candidate, regions);
    if (locations.length > 0) {
      result[candidate.id] = locations;
    }
  }
  return result;
}
