import type { EventCandidate, ParseWorkspace } from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { buildCandidateId } from "./candidateId.js";

function findSpan(
  text: string,
  needle: string,
): { start: number; end: number; matchedText: string } | null {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx < 0) return null;
  return {
    start: idx,
    end: idx + needle.length,
    matchedText: text.slice(idx, idx + needle.length),
  };
}

/** GeoProcessor: spawn place/region candidates (ADR-012 wrap GeoCatalog). */
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
    const span = findSpan(text, region.name);
    if (!span) continue;
    const id = buildCandidateId({
      rawMessageId: workspace.rawMessageId,
      spanStart: span.start,
      spanEnd: span.end,
      anchorKind: "region",
      anchorName: region.name,
    });
    regionCandidates.push({
      id,
      anchor: {
        kind: "region",
        name: region.name,
        regionCode: region.code,
        placeFias: region.fiasId,
        span,
      },
      eventType: "unknown",
      extras: {},
      provenance: {
        eventTypeSource: "pending",
        anchorSource: "geo-processor",
      },
    });
  }

  const placeCandidates: EventCandidate[] = [];
  for (const place of places) {
    const span = findSpan(text, place.name);
    if (!span) continue;
    const regionCode = geoCatalog.lookupRegionForPlaceName(place.name) ?? undefined;
    const id = buildCandidateId({
      rawMessageId: workspace.rawMessageId,
      spanStart: span.start,
      spanEnd: span.end,
      anchorKind: "place",
      anchorName: place.name,
    });
    placeCandidates.push({
      id,
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
    });
  }

  const regionCodesFromPlaces = new Set(
    placeCandidates.map((c) => c.anchor.regionCode).filter(Boolean),
  );
  const collapsedRegions = regionCandidates.filter((regionCandidate) => {
    const code = regionCandidate.anchor.regionCode;
    if (!code) return true;
    return !regionCodesFromPlaces.has(code);
  });

  workspace.candidates.push(...placeCandidates, ...collapsedRegions);
}
