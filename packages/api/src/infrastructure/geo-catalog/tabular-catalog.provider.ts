import * as fs from "node:fs";
import type { GeoProviderSnapshot, IGeoSourceProvider, RegionDraft } from "@radar/shared";
import { AllCitiesFiasCatalogProvider } from "../geo-providers/all-cities-fias/allCitiesFiasCatalogProvider";
import {
  ALL_CITIES_FIAS_SOURCE_REVISION,
} from "../geo-providers/all-cities-fias/parseAllCitiesFiasXlsx";
import { resolveGeoCatalogPath } from "./catalog-paths";

export const TABULAR_CATALOG_SOURCE_ID = "tabular_catalog";

type CatalogRegionEntry = {
  iso: string;
  name: string;
  nameWithType?: string;
  shortName?: string;
  federalDistrict?: string;
  fiasId?: string | null;
  kladrId?: string | null;
  frontRegion?: boolean;
  borderRegion?: boolean;
  centroidLat?: number | null;
  centroidLon?: number | null;
};

/** Читает regions.json → RegionDraft для geo catalog import (шаг 1/4). */
function loadRegionDrafts(regionsPath: string): RegionDraft[] {
  const raw = fs.readFileSync(regionsPath, "utf8").replace(/^\uFEFF/, "");
  const entries = JSON.parse(raw) as CatalogRegionEntry[];

  return entries.map((entry) => ({
    iso: entry.iso,
    fiasId: entry.fiasId ?? undefined,
    kladrId: entry.kladrId ?? undefined,
    name: entry.name,
    nameWithType: entry.nameWithType,
    shortName: entry.shortName,
    federalDistrict: entry.federalDistrict,
    frontRegion: entry.frontRegion ?? false,
    borderRegion: entry.borderRegion ?? false,
    centroidLat: entry.centroidLat ?? undefined,
    centroidLon: entry.centroidLon ?? undefined,
    sourceMeta: { sourceLayer: "tabular_regions" },
  }));
}

/**
 * Шаг 1/4: regions.json + 03_all_cities.xlsx (FIAS).
 * Только словари — без геометрии OSM.
 */
export class TabularCatalogProvider implements IGeoSourceProvider {
  constructor(
    private readonly regionsPath = resolveGeoCatalogPath("tabular", "regions.json"),
    private readonly citiesPath = resolveGeoCatalogPath("tabular", "03_all_cities.xlsx"),
  ) {}

  async loadSnapshot(): Promise<GeoProviderSnapshot> {
    const regions = loadRegionDrafts(this.regionsPath);
    const citiesProvider = new AllCitiesFiasCatalogProvider(this.citiesPath);
    const citiesSnapshot = await citiesProvider.loadSnapshot();

    return {
      sourceId: TABULAR_CATALOG_SOURCE_ID,
      sourceRevision: ALL_CITIES_FIAS_SOURCE_REVISION,
      regions,
      places: citiesSnapshot.places,
      aliases: citiesSnapshot.aliases,
    };
  }
}
