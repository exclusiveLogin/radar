import type { EventCandidate, IPlaceScanPort, ParseWorkspace, PlaceScanHit } from "@radar/shared";
import { appendCandidate, rejectOwnCandidates } from "./parseProcessorContract.js";
import { stripConsequencePhrases } from "../parsing/consequencePhrases.js";

const AUTHOR = "geo-processor";
const ENRICHER = "catalog";

/**
 * Co-mention disambiguation: если среди хитов есть definite anchors (geoImprecise=false),
 * переразрешает imprecise-хиты внутри anchor-регионов.
 * Если место не найдено ни в одном anchor-регионе — хит дропается.
 *
 * Пример: «Приморск — Мангуш»
 *   Мангуш → RU-ZP (definite anchor)
 *   Приморск → RU-KGD (imprecise, несколько кандидатов)
 *   matchPlaces("Приморск", { regionScopeIso: "RU-ZP" }) → [] → drop
 */
function inferScopeFromCompanions(
  hits: PlaceScanHit[],
  placeScan: IPlaceScanPort,
): PlaceScanHit[] {
  const anchorRegions = hits
    .filter((h) => !h.geoImprecise && h.entry.regionIso)
    .map((h) => h.entry.regionIso);

  if (anchorRegions.length === 0) return hits;

  return hits.flatMap((hit) => {
    if (!hit.geoImprecise) return [hit];

    for (const regionIso of anchorRegions) {
      const scoped = placeScan.matchPlaces(hit.span.matchedText, { regionScopeIso: regionIso });
      if (scoped.length > 0) {
        // Нашли в anchor-регионе → уточнённый хит без флага неопределённости
        return [{ ...scoped[0]!, span: hit.span, geoImprecise: false }];
      }
    }

    // Нет ни в одном anchor-регионе → дропаем неопределённый хит
    return [];
  });
}

/** GeoProcessor: DB-backed spawn через IPlaceScanPort (ADR-012 P6). */
export function runGeoProcessor(input: {
  workspace: ParseWorkspace;
  placeScan: IPlaceScanPort;
}): void {
  const { workspace, placeScan } = input;
  // Срезаем фразы-последствия (омонимы НП: «осколки» → д. Осколки) ДО гео-скана.
  // Тип события извлекается отдельно из полного groomedText (event-type-processor),
  // поэтому маскировка спанов здесь не влияет на классификацию.
  const text = stripConsequencePhrases(workspace.groomedText);

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
  const rawPlaceHits =
    workspace.namespaces.geoConflict === true ? unscopedPlaceHits : scopedPlaceHits;

  // Co-mention disambiguation: применяем только когда нет явного региона в тексте и нет конфликта,
  // то есть именно в случаях когда оба места «свободно» матчились без контекста.
  const placeHits =
    !regionScopeIso && workspace.namespaces.geoConflict !== true
      ? inferScopeFromCompanions(rawPlaceHits, placeScan)
      : rawPlaceHits;

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
