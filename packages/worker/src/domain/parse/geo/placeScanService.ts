import type {
  IPlaceScanPort,
  PlaceResolveContext,
  PlaceScanEntry,
  PlaceScanHit,
} from "@radar/shared";
import { tokenizeGeoSpans } from "./geoSpanTokenizer.js";
import { PlaceScanIndex, mergeSpanHit } from "./placeScanIndex.js";
import { resolveRegionScopeIds, resolveStemToEntry } from "./placeResolvePolicy.js";

/** Domain service: DB-backed geo scan для parse (implements IPlaceScanPort). */
export class PlaceScanService implements IPlaceScanPort {
  private readonly index: PlaceScanIndex;

  constructor(
    entries: PlaceScanEntry[],
    private readonly revisionHash: string,
  ) {
    this.index = new PlaceScanIndex(entries);
  }

  revision(): string {
    return this.revisionHash;
  }

  matchRegions(text: string): PlaceScanHit[] {
    return this.index.matchRegions(text);
  }

  matchPlaces(text: string, ctx: PlaceResolveContext): PlaceScanHit[] {
    const regionScopeIds = resolveRegionScopeIds({
      regionScopeId: ctx.regionScopeId,
      regionScopeIso: ctx.regionScopeIso,
      explicitRegionIsos: ctx.explicitRegionIsos,
      regionEntries: this.index.regionEntries,
    });

    const hits: PlaceScanHit[] = [];
    const seen = new Set<string>();

    const pushHit = (hit: PlaceScanHit) => {
      const key = `${hit.entry.placeId}:${hit.span.start}`;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push(hit);
    };

    // ADR-012: без regionScope — phrase только city+; stem-путь дублирует с kindFloor.
    // regionScopeIds сужает пул внутри резолва: однозначное имя среди найденных субъектов.
    for (const hit of this.index.matchPlacesByPhrase(text, {
      minKind: "city",
      regionScopeIds,
    })) {
      pushHit(hit);
    }

    for (const token of tokenizeGeoSpans(text)) {
      const resolved = resolveStemToEntry(this.index.entriesByStem, {
        label: token.lookupLabel,
        kindHint: token.kindHint,
        regionScopeIds,
        allowDistrict: token.kindHint === "district",
      });
      if (!resolved) continue;
      pushHit(
        mergeSpanHit(
          resolved.entry,
          {
            start: token.start,
            end: token.end,
            matchedText: token.matchedText,
          },
          resolved.geoImprecise,
          {
            matchedViaAdjectiveStem: resolved.matchedViaAdjectiveStem,
            stemPoolSize: resolved.stemPoolSize,
          },
        ),
      );
    }

    return hits.sort((a, b) => a.span.start - b.span.start);
  }

  async regionIsoForPlace(placeId: string): Promise<string | null> {
    return this.index.entriesById.get(placeId)?.regionIso ?? null;
  }
}
