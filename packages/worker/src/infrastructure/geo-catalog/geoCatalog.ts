import * as path from "node:path";
import { CityCatalog, type CityCatalogEntry } from "./cityCatalog.js";
import { extractFallbackCities } from "./cityFallbackExtractors.js";
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
  ) {}

  static loadFromArtifacts(artifactsRoot = resolveArtifactsRoot()): GeoCatalog {
    const regionCsvPath = path.join(
      artifactsRoot,
      "reference",
      "hflabs-region",
      "region.csv",
    );
    const citiesPath = path.join(
      artifactsRoot,
      "boundaries",
      "Russia_geojson_OSM",
      "GeoJson's",
      "Cities",
    );

    return new GeoCatalog(
      RegionCatalog.loadFromCsv(regionCsvPath),
      CityCatalog.loadFromDirectory(citiesPath),
    );
  }

  findRegion(rawText: string): RegionCatalogEntry | null {
    return this.regions.findRegionInText(rawText);
  }

  findRegions(rawText: string): RegionCatalogEntry[] {
    return this.regions.findRegionsInText(rawText);
  }

  findPlacesInRegion(rawText: string, _regionCode?: string): GeoCatalogPlace[] {
    return deduplicatePlaces(collectCandidatePlaces(rawText, this.cities));
  }

  listCities(): CityCatalogEntry[] {
    return this.cities.list();
  }

  listRegions(): RegionCatalogEntry[] {
    return this.regions.list();
  }
}
