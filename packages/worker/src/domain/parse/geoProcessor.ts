import type { EventCandidate, IPlaceScanPort, ParseWorkspace } from "@radar/shared";
import { appendCandidate, rejectOwnCandidates } from "./parseProcessorContract.js";

const AUTHOR = "geo-processor";
const ENRICHER = "catalog";

/** GeoProcessor: DB-backed spawn через IPlaceScanPort (ADR-012 P6). */
export function runGeoProcessor(input: {
  workspace: ParseWorkspace;
  placeScan: IPlaceScanPort;
}): void {
  const { workspace, placeScan } = input;
  const text = workspace.groomedText;

  const regionHits = placeScan.matchRegions(text);
  const explicitRegionIsos = regionHits.map((h) => h.entry.regionIso);
  const regionScopeIso =
    explicitRegionIsos.length === 1 ? explicitRegionIsos[0] : undefined;

  // Пустой ctx — без auto regionScope (pickRegionScopeIso иначе режет чужие place)
  const unscopedPlaceHits = placeScan.matchPlaces(text, {});
  const scopedPlaceHits = regionScopeIso
    ? placeScan.matchPlaces(text, { regionScopeIso, explicitRegionIsos })
    : unscopedPlaceHits;

  detectGeoConflict(workspace, regionHits, unscopedPlaceHits);
  const placeHits =
    workspace.namespaces.geoConflict === true ? unscopedPlaceHits : scopedPlaceHits;

  for (const hit of regionHits) {
    appendCandidate({
      workspace,
      authorProcessorId: AUTHOR,
      authorEnricherId: ENRICHER,
      anchor: {
        kind: "region",
        name: hit.entry.name,
        placeId: hit.entry.placeId,
        regionCode: hit.entry.regionIso,
        span: hit.span,
      },
      eventType: "unknown",
      provenance: {
        eventTypeSource: "pending",
        anchorSource: "geo-processor",
      },
    });
  }

  const placeCandidates: EventCandidate[] = [];
  for (const hit of placeHits) {
    placeCandidates.push(
      appendCandidate({
        workspace,
        authorProcessorId: AUTHOR,
        authorEnricherId: ENRICHER,
        anchor: {
          kind: "place",
          name: hit.entry.name,
          placeId: hit.entry.placeId,
          regionCode: hit.entry.regionIso,
          lat: hit.entry.centroidLat,
          lon: hit.entry.centroidLon,
          span: hit.span,
        },
        eventType: "unknown",
        extras: hit.geoImprecise ? { geoImprecise: true } : {},
        provenance: {
          eventTypeSource: "pending",
          anchorSource: "geo-processor",
        },
      }),
    );
  }

  if (workspace.namespaces.geoConflict === true) return;

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

/** Конфликт: явный субъект в тексте ≠ region place-hit. */
function detectGeoConflict(
  workspace: ParseWorkspace,
  regionHits: ReturnType<IPlaceScanPort["matchRegions"]>,
  placeHits: ReturnType<IPlaceScanPort["matchPlaces"]>,
): void {
  if (regionHits.length === 0 || placeHits.length === 0) return;
  const textRegionIsos = new Set(regionHits.map((h) => h.entry.regionIso));
  for (const place of placeHits) {
    if (!textRegionIsos.has(place.entry.regionIso)) {
      workspace.namespaces.geoConflict = true;
      return;
    }
  }
}
