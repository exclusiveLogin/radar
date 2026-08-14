import type { GeoNode, IRegionAdjacencyRepository } from "@radar/shared";
import { normalizeRegionCodeAlias } from "@radar/shared";
import {
  isBlockedRegionCatalogLookup,
  lookupLocalityRegionForPlace,
  resolvePlaceRegionCodeInContext,
} from "../../../domain/geo/geographicTextContext.js";
import type { GeoCatalog } from "../../../infrastructure/geo-catalog/index.js";
import type { LlmEnricher } from "../../../infrastructure/enrichers/llmEnricher.js";
import { isLlmOpHardFailure } from "../../../domain/parse/geo/llmOpResult.js";
import type { GeoPipelineContext, GeoPipelineStep } from "../GeoPipelineContext.js";

function resolvePriorRegions(ctx: GeoPipelineContext) {
  const fromCatalog = ctx.artifact.catalog?.regions ?? [];
  if (fromCatalog.length > 0) {
    return fromCatalog;
  }
  return ctx.artifact.finalizer?.regions ?? [];
}

function resolvePriorPlaces(ctx: GeoPipelineContext) {
  const fromCatalog = ctx.artifact.catalog?.places ?? [];
  if (fromCatalog.length > 0) {
    return fromCatalog;
  }
  return (ctx.artifact.finalizer?.places ?? []).map((place) => ({
    name: place.name,
    kind: place.kind,
    regionCode: undefined as string | undefined,
    lat: place.lat,
    lon: place.lon,
  }));
}

/** Prior region codes + смежные субъекты — подсказка LLM о допустимых регионах. */
function expandWithNeighbors(
  priorRegionCodes: string[],
  adjacency: Record<string, string[]>,
): string[] {
  const codes = new Set(priorRegionCodes);
  for (const code of priorRegionCodes) {
    for (const neighbor of adjacency[code] ?? []) {
      codes.add(neighbor);
    }
  }
  return [...codes];
}

function emptyLlmArtifact(reason: string) {
  return {
    schemaVersion: 1 as const,
    nodes: [] as GeoNode[],
    confidence: 0,
    reason,
  };
}

export class LlmStep implements GeoPipelineStep {
  readonly id = "llm";

  constructor(
    private readonly enricher: LlmEnricher,
    private readonly geoCatalog: GeoCatalog,
    private readonly regionAdjacency?: IRegionAdjacencyRepository,
  ) {}

  async run(ctx: GeoPipelineContext): Promise<void> {
    const priorRegions = resolvePriorRegions(ctx);
    const priorPlaces = resolvePriorPlaces(ctx);
    const anchors = this.geoCatalog.findLocalityAnchors(ctx.rawText);
    const localityCatalog = this.geoCatalog.listLocalityCatalog();
    const regionCode = priorRegions[0]?.code;
    const priorRegionCodes = priorRegions.map((region) => region.code);
    const knownRegionCodes =
      priorRegionCodes.length > 0
        ? expandWithNeighbors(priorRegionCodes, (await this.regionAdjacency?.load()) ?? {})
        : undefined;

    const result = await this.enricher.enrich({
      rawText: ctx.rawText,
      regionCode,
      catalogRegions: priorRegions.length > 0 ? priorRegions : undefined,
      localityAnchors: anchors.length > 0 ? anchors : undefined,
      priorRegions: priorRegions.length > 0 ? priorRegions : undefined,
      priorPlaces: priorPlaces.length > 0 ? priorPlaces : undefined,
      priorValidatedLocations:
        ctx.priorValidatedLocations && ctx.priorValidatedLocations.length > 0
          ? ctx.priorValidatedLocations
          : undefined,
      knownRegionCodes,
    });

    if (!result.ok) {
      ctx.artifact.llm = emptyLlmArtifact(result.reason);
      // disabled / no-signal — фаза продолжается; hard fail → markFailed снаружи.
      if (isLlmOpHardFailure(result.reason)) {
        throw new Error(`llm:${result.reason}`);
      }
      return;
    }

    const payload = result.data;
    const nodes: GeoNode[] = [];

    const normName = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();
    const firstWord = (s: string) => normName(s).split(/\s+/)[0] ?? "";

    const lookupRegionCode = (placeName: string): string | undefined => {
      const exact = priorRegions.find(
        (r) => normName(r.name) === normName(placeName),
      );
      if (exact) {
        return exact.code;
      }
      return priorRegions.find(
        (r) =>
          firstWord(r.name) === firstWord(placeName)
          && !isBlockedRegionCatalogLookup(
            placeName,
            r.name,
            r.code,
            anchors,
          ),
      )?.code;
    };

    const multiPlaceContext =
      payload.places.filter((place) => place.kind !== "region").length > 1
      || anchors.length > 1;

    const regionsCollected = priorRegions.map((region) => ({
      code: region.code,
      name: region.name,
    }));

    for (const place of payload.places) {
      const isRegion = place.kind === "region";

      const rawRegionCode = place.regionCode ?? payload.regionCode ?? undefined;
      const llmValidatedRegionCode = rawRegionCode
        ? normalizeRegionCodeAlias(rawRegionCode)
        : undefined;

      const placeRegionCode = isRegion
        ? resolvePlaceRegionCodeInContext({
            placeName: place.placeName,
            placeRegionCode:
              llmValidatedRegionCode
              ?? lookupRegionCode(place.placeName),
            rawText: ctx.rawText,
            anchorsInText: anchors,
            localityCatalog,
            regionsCollected,
            multiPlaceContext,
          })
          ?? undefined
        : lookupLocalityRegionForPlace(place.placeName, localityCatalog)
          ?? resolvePlaceRegionCodeInContext({
            placeName: place.placeName,
            placeRegionCode: llmValidatedRegionCode,
            rawText: ctx.rawText,
            anchorsInText: anchors,
            localityCatalog,
            regionsCollected,
            multiPlaceContext,
          })
          ?? undefined;

      if (!placeRegionCode) {
        continue;
      }

      nodes.push({
        name: place.placeName,
        kind: isRegion ? "region" : place.kind,
        regionCode: normalizeRegionCodeAlias(placeRegionCode),
        fiasId: place.placeFias ?? undefined,
        confidence: place.confidence ?? payload.confidence,
        reason: place.reason ?? undefined,
      });
    }

    ctx.artifact.llm = {
      schemaVersion: 1,
      nodes,
      confidence: payload.confidence,
      reason: payload.reason,
      eventCategory: payload.eventCategory ?? undefined,
      eventSubject: payload.eventSubject ?? undefined,
    };
  }
}
