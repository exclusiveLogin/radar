import type { EventCandidate, EventLocation, IRegionRepository, ParseWorkspace, RegionRecord } from "@radar/shared";
import {
  canonicalRegionCode,
  normalizeRegionCodeAlias,
} from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import {
  findLocalityAnchorsInText,
  resolvePlaceRegionCodeInContext,
} from "../geo/geographicTextContext.js";
import { listActiveCandidates } from "./parseProcessorContract.js";

/** regionCode для anchor: явный на candidate → контекст сообщения (RVK + субъект). */
function resolveAnchorRegionCode(
  candidate: EventCandidate,
  geoCatalog: GeoCatalog,
  workspace: ParseWorkspace,
): string | undefined {
  const onAnchor = candidate.anchor.regionCode?.trim();
  if (onAnchor) {
    return normalizeRegionCodeAlias(onAnchor);
  }

  if (candidate.anchor.kind !== "place") {
    return undefined;
  }

  const text = workspace.groomedText;
  const localityCatalog = geoCatalog.listLocalityCatalog();
  const regionsCollected = geoCatalog.findRegions(text).map((region) => ({
    code: region.code,
    name: region.name,
    fiasId: region.fiasId,
    aliases: region.aliases,
  }));
  const anchorsInText = findLocalityAnchorsInText(text, localityCatalog);
  const placeCount = listActiveCandidates(workspace).filter((c) => c.anchor.kind === "place").length;
  const catalogCode = geoCatalog.lookupRegionForPlaceName(candidate.anchor.name);

  const code = resolvePlaceRegionCodeInContext({
    placeName: candidate.anchor.name,
    placeRegionCode: catalogCode ?? undefined,
    rawText: text,
    anchorsInText,
    localityCatalog,
    regionsCollected,
    multiPlaceContext: placeCount > 1,
  });

  return code ? normalizeRegionCodeAlias(code) : undefined;
}

/** Резолв region row по anchor candidate (code → контекст → catalog lookup для place). */
async function resolveRegionForCandidate(
  regions: IRegionRepository,
  candidate: EventCandidate,
  geoCatalog?: GeoCatalog,
  workspace?: ParseWorkspace,
): Promise<RegionRecord | null> {
  const code =
    geoCatalog && workspace
      ? resolveAnchorRegionCode(candidate, geoCatalog, workspace)
      : candidate.anchor.regionCode?.trim()
        ? normalizeRegionCodeAlias(candidate.anchor.regionCode.trim())
        : undefined;

  if (code) {
    const byCode = await regions.findByCode(normalizeRegionCodeAlias(code));
    if (byCode) return byCode;
  }

  if (candidate.anchor.kind === "place" && geoCatalog && !workspace) {
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
  workspace?: ParseWorkspace,
): Promise<EventLocation[]> {
  if (candidate.anchor.kind === "system") {
    return [];
  }

  const region = await resolveRegionForCandidate(regions, candidate, geoCatalog, workspace);
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
    const locations = await deriveEventLocationsFromCandidate(
      candidate,
      regions,
      geoCatalog,
      workspace,
    );
    if (locations.length > 0) {
      result[candidate.id] = locations;
    }
  }
  return result;
}
