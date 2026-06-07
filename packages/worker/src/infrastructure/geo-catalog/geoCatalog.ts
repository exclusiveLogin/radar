import * as fs from "node:fs";
import * as path from "node:path";
import {
  filterRegionsByTextContext,
  findLocalityAnchorsInText,
  lookupLocalityRegionForPlace,
  type LocalityAnchor,
} from "../../domain/geo/geographicTextContext.js";
import { CityCatalog, type CityCatalogEntry } from "./cityCatalog.js";
import { extractFallbackCities } from "./cityFallbackExtractors.js";
import { KnownLocalityCatalog } from "./knownLocalityCatalog.js";
import { repoDataPath } from "../../shims/monorepo-root.js";
import {
  RegionCatalog,
  resolveArtifactsRoot,
  type RegionCatalogEntry,
} from "./regionCatalog.js";

export type GeoCatalogPlace = {
  name: string;
  kind: "district" | "city" | "locality" | "settlement";
  lat?: number;
  lon?: number;
  alias?: string;
};
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function cleanDistrictName(value: string): string {
  return value
    .replace(
      /^(?:бпла|бплаи?|угроза|опасность|внимание|фиксация|отбой)\s+(?:по\s+|на\s+)?/i,
      "",
    )
    .replace(/^(?:по|на|в|во|к|из|от)\s+/i, "")
    .trim();
}
function collectDistricts(rawText: string): GeoCatalogPlace[] {
  const districtRegex =
    /(?:^|[^\p{L}\p{N}_])([а-яёА-ЯЁa-zA-Z][а-яёА-ЯЁa-zA-Z\-\s]{1,40}?\sрайон)(?=[^\p{L}\p{N}_]|$)/giu;
  const districts: GeoCatalogPlace[] = [];

  for (const match of rawText.matchAll(districtRegex)) {
    const districtName = cleanDistrictName(match[1]?.trim() ?? "");
    if (!districtName) continue;
    districts.push({ name: districtName, kind: "district" });
  }

  return districts;
}
function collectCityPlaces(cities: CityCatalogEntry[]): GeoCatalogPlace[] {
  return cities.map((city) => ({
    name: city.name,
    kind: "city",
    lat: city.lat,
    lon: city.lon,
  }));
}
function collectFallbackCities(rawText: string): GeoCatalogPlace[] {
  return extractFallbackCities(rawText).map((cityName) => ({
    name: cityName,
    kind: "city",
  }));
}
function deduplicatePlaces(places: GeoCatalogPlace[]): GeoCatalogPlace[] {
  const unique = new Map<string, GeoCatalogPlace>();
  for (const place of places) {
    unique.set(`${place.kind}:${normalize(place.name)}`, place);
  }
  return [...unique.values()];
}
function collectCandidatePlaces(
  rawText: string,
  cities: CityCatalog,
): GeoCatalogPlace[] {
  return [
    ...collectDistricts(rawText),
    ...collectCityPlaces(cities.findInText(rawText)),
    ...collectFallbackCities(rawText),
  ];
}

export class GeoCatalog {
  constructor(
    private readonly regions: RegionCatalog,
    private readonly cities: CityCatalog,
    private readonly knownLocalities: KnownLocalityCatalog,
  ) {}
  /** Для wipe/reset CLI когда data/geo/artifacts ещё нет. */
  static empty(): GeoCatalog {
    return new GeoCatalog(
      RegionCatalog.empty(),
      CityCatalog.empty(),
      KnownLocalityCatalog.empty(),
    );
  }

  static loadFromArtifacts(artifactsRoot = resolveArtifactsRoot()): GeoCatalog {
    const catalogPath = repoDataPath("geo", "catalog", "regions.json");
    if (!fs.existsSync(catalogPath)) {
      throw new Error(
        `Regions catalog not found: ${catalogPath}. Run npm run geo:regions:seed after filling regions.json.`,
      );
    }

    const citiesPath = path.join(
      artifactsRoot,
      "boundaries",
      "Russia_geojson_OSM",
      "GeoJson's",
      "Cities",
    );
    const cities = fs.existsSync(citiesPath)
      ? CityCatalog.loadFromDirectory(citiesPath)
      : CityCatalog.empty();

    return new GeoCatalog(
      RegionCatalog.loadFromCatalogJson(catalogPath),
      cities,
      KnownLocalityCatalog.loadFromDictionaries(),
    );
  }
/** Якорные города из places.json, найденные в тексте целиком. */
  findLocalityAnchors(rawText: string): LocalityAnchor[] {
    return findLocalityAnchorsInText(rawText, this.knownLocalities.list());
  }
private toRegionCandidate(entry: RegionCatalogEntry) {
    return {
      code: entry.code,
      name: entry.name,
      fiasId: entry.fiasId,
      aliases: entry.aliases,
    };
  }
getRegionByCode(code: string): RegionCatalogEntry | null {
    return this.regions.getByCode(code);
  }
findRegion(rawText: string): RegionCatalogEntry | null {
    return this.regions.findRegionInText(rawText);
  }
findRegions(rawText: string): RegionCatalogEntry[] {
    const anchors = this.findLocalityAnchors(rawText);
    const matched = this.regions.findRegionsInText(rawText);
    const filtered = filterRegionsByTextContext(
      matched.map((entry) => this.toRegionCandidate(entry)),
      rawText,
      anchors,
    );
    const byCode = new Map(matched.map((entry) => [entry.code, entry]));
    return filtered.map(
      (candidate) =>
        byCode.get(candidate.code) ?? {
          code: candidate.code,
          name: candidate.name,
          fiasId: candidate.fiasId,
          aliases: candidate.aliases ?? [],
        },
    );
  }
findPlacesInRegion(rawText: string, _regionCode?: string): GeoCatalogPlace[] {
    return deduplicatePlaces(collectCandidatePlaces(rawText, this.cities));
  }
  /** Субъект РФ для названия НП из places.json (не регион канала/первого якоря). */
  lookupRegionForPlaceName(placeName: string): string | null {
    return lookupLocalityRegionForPlace(placeName, this.knownLocalities.list());
  }
  /** Полный справочник якорных НП (places.json). */
  listLocalityCatalog(): LocalityAnchor[] {
    return this.knownLocalities.list();
  }
listCities(): CityCatalogEntry[] {
    return this.cities.list();
  }
listRegions(): RegionCatalogEntry[] {
    return this.regions.list();
  }
  /** Прямой доступ к каталогу регионов (для extractPvoStats и аналогичных экстракторов). */
  getRegionCatalog(): RegionCatalog {
    return this.regions;
  }
}
