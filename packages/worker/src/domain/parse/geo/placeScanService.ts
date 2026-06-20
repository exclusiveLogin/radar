import type {
  IPlaceScanPort,
  PlaceResolveContext,
  PlaceScanEntry,
  PlaceScanHit,
} from "@radar/shared";
import { tokenizeGeoSpans } from "./geoSpanTokenizer.js";
import { PlaceScanIndex, mergeSpanHit } from "./placeScanIndex.js";
import { pickRegionScopeIso, resolveStemToEntry } from "./placeResolvePolicy.js";

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
    const regionScopeIso = ctx.regionScopeIso
      ?? pickRegionScopeIso(ctx.explicitRegionIsos);
    const regionScopeId = ctx.regionScopeId
      ?? (regionScopeIso
        ? this.index.regionEntries.find((e) => e.regionIso === regionScopeIso)?.regionId
        : undefined);

    const hits: PlaceScanHit[] = [];
    const seen = new Set<string>();

    const pushHit = (hit: PlaceScanHit) => {
      const key = `${hit.entry.placeId}:${hit.span.start}`;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push(hit);
    };

    for (const hit of this.index.matchPlacesByPhrase(text)) {
      if (regionScopeId && hit.entry.regionId !== regionScopeId) continue;
      pushHit(hit);
    }

    for (const token of tokenizeGeoSpans(text)) {
      const resolved = resolveStemToEntry(this.index.entriesByStem, {
        label: token.lookupLabel,
        kindHint: token.kindHint,
        regionScopeId,
        regionScopeIso,
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
        ),
      );
    }

    return hits.sort((a, b) => a.span.start - b.span.start);
  }

  async regionIsoForPlace(placeId: string): Promise<string | null> {
    return this.index.entriesById.get(placeId)?.regionIso ?? null;
  }
}
