import type { EventCandidate, ParseWorkspace } from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import type { RegionCatalogEntry } from "../../infrastructure/geo-catalog/regionCatalog.js";
import {
  findLocalityAnchorsInText,
  resolvePlaceRegionCodeInContext,
} from "../geo/geographicTextContext.js";
import { appendCandidate, rejectOwnCandidates } from "./parseProcessorContract.js";

const AUTHOR = "geo-processor";
const ENRICHER = "catalog";

type TextSpan = { start: number; end: number; matchedText: string };

function findSpan(text: string, needle: string): TextSpan | null {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx < 0) return null;
  return {
    start: idx,
    end: idx + needle.length,
    matchedText: text.slice(idx, idx + needle.length),
  };
}

function findRegionSpan(text: string, region: RegionCatalogEntry): TextSpan | null {
  const needles = [region.name, ...region.aliases].filter((value) => value.length >= 4);
  let best: TextSpan | null = null;
  for (const needle of needles) {
    const span = findSpan(text, needle);
    if (!span) continue;
    if (!best || span.start < best.start) best = span;
  }
  return best;
}

/** GeoProcessor: append place/region candidates (ADR-012 wrap GeoCatalog). */
export function runGeoProcessor(input: {
  workspace: ParseWorkspace;
  geoCatalog: GeoCatalog;
}): void {
  const { workspace, geoCatalog } = input;
  const text = workspace.groomedText;
  const regions = geoCatalog.findRegions(text);
  const places = geoCatalog.findPlacesInRegion(text);

  const regionCandidates: EventCandidate[] = [];
  for (const region of regions) {
    const span = findRegionSpan(text, region);
    if (!span) continue;
    regionCandidates.push(
      appendCandidate({
        workspace,
        authorProcessorId: AUTHOR,
        authorEnricherId: ENRICHER,
        anchor: {
          kind: "region",
          name: region.name,
          regionCode: region.code,
          placeFias: region.fiasId,
          span,
        },
        eventType: "unknown",
        provenance: {
          eventTypeSource: "pending",
          anchorSource: "geo-processor",
        },
      }),
    );
  }

  const localityCatalog = geoCatalog.listLocalityCatalog();
  const anchorsInText = findLocalityAnchorsInText(text, localityCatalog);
  const regionsCollected = regions.map((region) => ({
    code: region.code,
    name: region.name,
    fiasId: region.fiasId,
    aliases: region.aliases,
  }));
  const multiPlaceContext = places.length > 1;

  const placeCandidates: EventCandidate[] = [];
  for (const place of places) {
    const span = findSpan(text, place.name);
    if (!span) continue;
    const regionCode =
      resolvePlaceRegionCodeInContext({
        placeName: place.name,
        placeRegionCode: geoCatalog.lookupRegionForPlaceName(place.name) ?? undefined,
        rawText: text,
        anchorsInText,
        localityCatalog,
        regionsCollected,
        multiPlaceContext,
      }) ?? undefined;
    placeCandidates.push(
      appendCandidate({
        workspace,
        authorProcessorId: AUTHOR,
        authorEnricherId: ENRICHER,
        anchor: {
          kind: "place",
          name: place.name,
          regionCode,
          lat: place.lat,
          lon: place.lon,
          span,
        },
        eventType: "unknown",
        extras: place.alias ? { geoImprecise: true } : {},
        provenance: {
          eventTypeSource: "pending",
          anchorSource: "geo-processor",
        },
      }),
    );
  }

  const regionCodesFromPlaces = new Set(
    placeCandidates.map((c) => c.anchor.regionCode).filter(Boolean),
  );
  if (regionCodesFromPlaces.size > 0) {
    rejectOwnCandidates({
      workspace,
      authorProcessorId: AUTHOR,
      predicate: (candidate) =>
        candidate.anchor.kind === "region"
        && Boolean(candidate.anchor.regionCode)
        && regionCodesFromPlaces.has(candidate.anchor.regionCode!),
    });
  }
}
