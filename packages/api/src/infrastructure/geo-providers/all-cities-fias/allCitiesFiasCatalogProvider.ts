import type { AliasDraft, GeoProviderSnapshot, IGeoSourceProvider, PlaceDraft } from "@radar/shared";
import { repoDataPath } from "../../../monorepo-root";
import { placeDraftKey } from "../../../application/geo-sync/diff-engine";
import {
  ALL_CITIES_FIAS_SOURCE_ID,
  ALL_CITIES_FIAS_SOURCE_REVISION,
  mapFiasRowsToPlaceDrafts,
  parseAllCitiesFiasXlsx,
} from "./parseAllCitiesFiasXlsx";

/**
 * Vendor-каталог НП РФ из data/geo/catalog/03_all_cities.xlsx (FIAS 2020, ~158k).
 * Подаётся в geo:db:apply через CompositeGeoProvider.
 */
export class AllCitiesFiasCatalogProvider implements IGeoSourceProvider {
  constructor(
    private readonly filePath = repoDataPath("geo", "catalog", "03_all_cities.xlsx"),
  ) {}

  loadSnapshot(): Promise<GeoProviderSnapshot> {
    const rows = parseAllCitiesFiasXlsx(this.filePath);
    const places = mapFiasRowsToPlaceDrafts(rows);
    const aliases = this.buildAliases(places);

    return Promise.resolve({
      sourceId: ALL_CITIES_FIAS_SOURCE_ID,
      sourceRevision: ALL_CITIES_FIAS_SOURCE_REVISION,
      regions: [],
      places,
      aliases,
    });
  }

  /** Авто-алиасы: каноническое имя + nameWithType. */
  private buildAliases(places: PlaceDraft[]): AliasDraft[] {
    const aliases: AliasDraft[] = [];
    for (const place of places) {
      const externalKey = placeDraftKey(place);
      aliases.push({
        targetKind: "place",
        targetExternalKey: externalKey,
        alias: place.name,
        source: "auto",
      });
      if (place.nameWithType && place.nameWithType !== place.name) {
        aliases.push({
          targetKind: "place",
          targetExternalKey: externalKey,
          alias: place.nameWithType,
          source: "auto",
        });
      }
    }
    return aliases;
  }
}

/** Для unit-тестов и диагностики без провайдера. */
export function loadAllCitiesFiasPlaceDrafts(
  filePath = repoDataPath("geo", "catalog", "03_all_cities.xlsx"),
): PlaceDraft[] {
  return mapFiasRowsToPlaceDrafts(parseAllCitiesFiasXlsx(filePath));
}

/** Сколько НП из xlsx попадёт в apply. */
export function countAllCitiesFiasPlaces(
  filePath = repoDataPath("geo", "catalog", "03_all_cities.xlsx"),
): number {
  return loadAllCitiesFiasPlaceDrafts(filePath).length;
}
