import * as fs from "node:fs";
import type { AliasDraft, GeoProviderSnapshot, IGeoSourceProvider, PlaceDraft } from "@radar/shared";
import { placeDraftKey } from "../../application/geo-sync/place-draft-key";
import { resolveGeoCatalogPath } from "./catalog-paths";

export const FRONTLINE_CATALOG_SOURCE_ID = "frontline_catalog";
export const FRONTLINE_CATALOG_SOURCE_REVISION = "places-dictionary-v1";

type PlacesDictionaryEntry = {
  regionCode: string;
  kind: PlaceDraft["kind"];
  name: string;
  nameWithType?: string;
  centroidLat?: number;
  centroidLon?: number;
  aliases?: string[];
};

/** Парсит curated places.json (Донбасс, НТ, Крым). */
function loadPlacesDictionary(filePath: string): PlacesDictionaryEntry[] {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw) as PlacesDictionaryEntry[];
}

function toPlaceDraft(entry: PlacesDictionaryEntry): PlaceDraft {
  return {
    regionCode: entry.regionCode,
    kind: entry.kind,
    name: entry.name,
    nameWithType: entry.nameWithType,
    centroidLat: entry.centroidLat,
    centroidLon: entry.centroidLon,
    aliases: entry.aliases,
    sourceMeta: { sourceLayer: "places_dictionary" },
  };
}

function buildAliases(places: PlaceDraft[]): AliasDraft[] {
  const aliases: AliasDraft[] = [];
  for (const place of places) {
    const externalKey = placeDraftKey(place);
    aliases.push({
      targetKind: "place",
      targetExternalKey: externalKey,
      alias: place.name,
      source: "manual",
    });
    if (place.nameWithType && place.nameWithType !== place.name) {
      aliases.push({
        targetKind: "place",
        targetExternalKey: externalKey,
        alias: place.nameWithType,
        source: "manual",
      });
    }
    for (const alias of place.aliases ?? []) {
      aliases.push({
        targetKind: "place",
        targetExternalKey: externalKey,
        alias,
        source: "manual",
      });
    }
  }
  return aliases;
}

/**
 * Шаг 2/4: curated override из places.json.
 * Последний в merge — перебивает FIAS для front-line НП.
 */
export class FrontlineCatalogProvider implements IGeoSourceProvider {
  constructor(
    private readonly placesPath = resolveGeoCatalogPath("frontline", "places.json"),
  ) {}

  loadSnapshot(): Promise<GeoProviderSnapshot> {
    const entries = loadPlacesDictionary(this.placesPath);
    const places = entries.map(toPlaceDraft);

    return Promise.resolve({
      sourceId: FRONTLINE_CATALOG_SOURCE_ID,
      sourceRevision: FRONTLINE_CATALOG_SOURCE_REVISION,
      regions: [],
      places,
      aliases: buildAliases(places),
    });
  }
}
