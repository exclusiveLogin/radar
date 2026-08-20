import type { EventCandidate, PlaceRecord, PlaceScanHit } from "@radar/shared";
import {
  shouldSuppressFederalSubjectMatch,
  type LocalityAnchor,
  type RegionCandidate,
} from "../../geo/geographicTextContext.js";

/** PlaceScanHit субъекта → RegionCandidate для контекстного фильтра. */
function toRegionCandidate(hit: PlaceScanHit): RegionCandidate {
  const { entry } = hit;
  const aliases = [entry.name, entry.regionShortName, entry.nameWithType].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  return {
    code: entry.regionIso,
    name: entry.nameWithType ?? entry.name,
    aliases,
  };
}

/** kind place → якорь для regionMatchesLocalityAnchors. */
function toLocalityAnchorKind(
  kind: PlaceRecord["kind"],
): LocalityAnchor["kind"] | null {
  switch (kind) {
    case "city":
    case "city_district":
    case "district":
      return "city";
    case "locality":
      return "locality";
    case "settlement":
      return "settlement";
    default:
      return null;
  }
}

/** Definite place-hits из geo scan → якоря субъекта в тексте. */
export function anchorsFromDefinitePlaceHits(hits: PlaceScanHit[]): LocalityAnchor[] {
  const anchors: LocalityAnchor[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    if (hit.geoImprecise || !hit.entry.regionIso || hit.entry.kind === "region") {
      continue;
    }
    const kind = toLocalityAnchorKind(hit.entry.kind);
    if (!kind) continue;

    const key = `${hit.entry.regionIso}:${hit.entry.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    anchors.push({
      name: hit.entry.name,
      regionCode: hit.entry.regionIso,
      kind,
    });
  }

  return anchors;
}

/** Place-candidates workspace → якоря для validate safety net. */
export function anchorsFromPlaceCandidates(candidates: EventCandidate[]): LocalityAnchor[] {
  const anchors: LocalityAnchor[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.anchor.kind !== "place") continue;
    if (candidate.extras?.geoImprecise === true) continue;
    const regionCode = candidate.anchor.regionCode;
    if (!regionCode) continue;

    const key = `${regionCode}:${candidate.anchor.name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    anchors.push({
      name: candidate.anchor.name,
      regionCode,
      kind: "city",
    });
  }

  return anchors;
}

/**
 * Отбрасывает ложные region-hit по прилагательному без явного типа субъекта
 * (SSOT: geographicTextContext.shouldSuppressFederalSubjectMatch).
 */
export function filterRegionScanHits(
  text: string,
  hits: PlaceScanHit[],
  anchors: LocalityAnchor[],
): PlaceScanHit[] {
  return hits.filter(
    (hit) => !shouldSuppressFederalSubjectMatch(text, toRegionCandidate(hit), anchors),
  );
}
