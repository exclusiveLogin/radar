import type { EventCandidate, EventLocation, IRegionRepository, ParseWorkspace, RegionRecord } from "@radar/shared";
import {
  canonicalRegionCode,
  normalizeRegionCodeAlias,
} from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { listActiveCandidates } from "./parseProcessorContract.js";

/** Резолв region row по anchor candidate (code → name → catalog lookup для place). */
async function resolveRegionForCandidate(
  regions: IRegionRepository,
  candidate: EventCandidate,
  geoCatalog?: GeoCatalog,
): Promise<RegionRecord | null> {
  const code = candidate.anchor.regionCode?.trim();
  if (code) {
    const byCode = await regions.findByCode(normalizeRegionCodeAlias(code));
    if (byCode) return byCode;
  }

  if (candidate.anchor.kind === "place" && geoCatalog) {
    const fromCatalog = geoCatalog.lookupRegionForPlaceName(candidate.anchor.name);
    if (fromCatalog) {
      const byCatalog = await regions.findByCode(normalizeRegionCodeAlias(fromCatalog));
      if (byCatalog) return byCatalog;
    }
  }

  const name = candidate.anchor.name?.trim();
  if (name) {
    const byName = await regions.findByCode(name);
    if (byName) return byName;
  }

  return null;
}

/** Проекция anchor candidate → EventLocation[] с реальным region_id из БД. */
export async function deriveEventLocationsFromCandidate(
  candidate: EventCandidate,
  regions: IRegionRepository,
  geoCatalog?: GeoCatalog,
): Promise<EventLocation[]> {
  if (candidate.anchor.kind === "system") {
    return [];
  }

  const region = await resolveRegionForCandidate(regions, candidate, geoCatalog);
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
  geoCatalog?: GeoCatalog,
): Promise<Record<string, EventLocation[]>> {
  const result: Record<string, EventLocation[]> = {};
  for (const candidate of listActiveCandidates(workspace)) {
    const locations = await deriveEventLocationsFromCandidate(candidate, regions, geoCatalog);
    if (locations.length > 0) {
      result[candidate.id] = locations;
    }
  }
  return result;
}
