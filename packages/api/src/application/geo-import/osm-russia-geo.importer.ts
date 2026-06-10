/**
 * Импортирует структурную геометрию из OSM-артефактов в geo_feature
 * и привязывает к уже существующим places (после tabular/frontline import).
 *
 * 5 источников в порядке обхода:
 *  1. Countries/Russia_regions.geojson         → layer=subject (85 РФ)
 *  2. supplemental/front-regions.geojson       → layer=subject (4 НТ + доп.)
 *  3. Regions/{FO}/{RegionName}_{EN}.geojson   → layer=district (районы субъектов)
 *  4. Cities/{CityName}_{EN}.geojson           → layer=city_district (районы городов)
 *  5. Federal Districts/*.geojson              → layer=federal_district (8 ФО)
 *
 * Идемпотентен: geo_feature upsert по (region_id, layer, name_stem);
 * places не создаются — только link geo_feature_id.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { placeStem } from "@radar/shared";
import type { PlaceRecord, RegionRecord } from "@radar/shared";
import {
  geometryLinkFallbackKinds,
} from "../../infrastructure/geo-catalog/osm-layer-kind";
import { RegionGeometryCatalog } from "../../map/region-geometry.catalog";
import { TypeOrmRegionRepository } from "../../infrastructure/persistence/typeorm-region.repository";
import { TypeOrmPlaceRepository } from "../../infrastructure/persistence/typeorm-place.repository";
import { MONOREPO_ROOT } from "../../monorepo-root";

// ─── Константы путей ──────────────────────────────────────────────────────────

const OSM_ROOT = path.join(
  MONOREPO_ROOT,
  "data", "geo", "artifacts", "boundaries", "Russia_geojson_OSM", "GeoJson's",
);
const SUPPLEMENTAL_ROOT = path.join(
  MONOREPO_ROOT,
  "data", "geo", "artifacts", "boundaries", "supplemental",
);

// ─── Маппинг папки ФО → русское название ──────────────────────────────────────

const FO_CODE_TO_NAME: Record<string, string> = {
  CFO:   "Центральный",
  DFO:   "Дальневосточный",
  PFO:   "Приволжский",
  SFO:   "Сибирский",
  SKFO:  "Северо-Кавказский",
  SZFO:  "Северо-Западный",
  UFO:   "Уральский",
  YUFO:  "Южный",
  Crimea: "Южный",
};

// ─── Вспомогательные типы ─────────────────────────────────────────────────────

type GeoJsonGeometry = {
  type: string;
  coordinates: unknown;
};

type GeoJsonFeature = {
  type: "Feature";
  properties: Record<string, string | number | null>;
  geometry: GeoJsonGeometry;
};

type GeoJsonCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

/** Bbox вычисленный из геометрии. */
type BboxTuple = [number, number, number, number]; // [west, south, east, north]

// ─── Статистика прогона ────────────────────────────────────────────────────────

export type ImportStats = {
  subjectsUpserted: number;
  districtsUpserted: number;
  cityDistrictsUpserted: number;
  federalDistrictsUpserted: number;
  placesLinked: number;
  orphanFeatures: number;
  placeGeoLinksCreated: number;
};

// ─── OsmRussiaGeoImporter ────────────────────────────────────────────────────

export class OsmRussiaGeoImporter {
  private readonly regions: TypeOrmRegionRepository;
  private readonly places: TypeOrmPlaceRepository;

  private readonly geometryCatalog = RegionGeometryCatalog.getInstance();

  /** ISO → region record — строится один раз перед прогоном. */
  private regionByIso = new Map<string, RegionRecord>();

  constructor(private readonly dataSource: DataSource) {
    this.regions = new TypeOrmRegionRepository(dataSource);
    this.places  = new TypeOrmPlaceRepository(dataSource);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Полный идемпотентный прогон всех 5 источников OSM. */
  async run(): Promise<ImportStats> {
    await this.buildRegionIndex();

    const stats: ImportStats = {
      subjectsUpserted: 0,
      districtsUpserted: 0,
      cityDistrictsUpserted: 0,
      federalDistrictsUpserted: 0,
      placesLinked: 0,
      orphanFeatures: 0,
      placeGeoLinksCreated: 0,
    };

    // 1. Субъекты из Russia_regions.geojson
    stats.subjectsUpserted += await this.importSubjects(
      path.join(OSM_ROOT, "Countries", "Russia_regions.geojson"),
      0,
    );

    // 2. Субъекты из supplemental/front-regions.geojson (НТ, приоритет выше)
    stats.subjectsUpserted += await this.importSubjects(
      path.join(SUPPLEMENTAL_ROOT, "front-regions.geojson"),
      10,
    );

    // 3. Районы субъектов из Regions/{FO}/*.geojson
    const regionsDir = path.join(OSM_ROOT, "Regions");
    for (const foFolder of readdirSafe(regionsDir)) {
      const foPath = path.join(regionsDir, foFolder);
      if (!fs.statSync(foPath).isDirectory()) continue;
      for (const file of readdirSafe(foPath)) {
        if (!file.endsWith(".geojson")) continue;
        const count = await this.importDistricts(
          path.join(foPath, file),
          foFolder,
          "district",
        );
        stats.districtsUpserted += count.features;
        stats.placesLinked += count.linked;
        stats.orphanFeatures += count.orphans;
      }
    }

    // 4. Районы городов из Cities/*.geojson
    const citiesDir = path.join(OSM_ROOT, "Cities");
    for (const file of readdirSafe(citiesDir)) {
      if (!file.endsWith(".geojson")) continue;
      const count = await this.importDistricts(
        path.join(citiesDir, file),
        null,
        "city_district",
      );
      stats.cityDistrictsUpserted += count.features;
      stats.placesLinked += count.linked;
      stats.orphanFeatures += count.orphans;
    }

    // 5. Федеральные округа из Federal Districts/*.geojson
    const fedDir = path.join(OSM_ROOT, "Federal Districts");
    for (const file of readdirSafe(fedDir)) {
      if (!file.endsWith(".geojson")) continue;
      stats.federalDistrictsUpserted += await this.importFederalDistrict(
        path.join(fedDir, file),
      );
    }

    return stats;
  }

  // ─── Построение индекса регионов ────────────────────────────────────────────

  private async buildRegionIndex(): Promise<void> {
    const allRegions = await this.regions.listActive();
    this.regionByIso.clear();

    for (const region of allRegions) {
      if (region.iso) {
        this.regionByIso.set(region.iso, region);
      }
    }

    this.geometryCatalog.bindRegions(
      allRegions
        .filter((r) => r.iso)
        .map((r) => ({
          iso: r.iso!,
          name: r.name,
          nameWithType: r.nameWithType,
          shortName: r.shortName,
        })),
    );
  }

  // ─── 1 + 2: Субъекты ────────────────────────────────────────────────────────

  private async importSubjects(filePath: string, priority: number): Promise<number> {
    const collection = readGeoJson(filePath);
    if (!collection) return 0;

    let upserted = 0;
    for (const feature of collection.features) {
      const label = String(feature.properties["region"] ?? feature.properties["regionCode"] ?? "");
      const isoFromProp = String(feature.properties["regionCode"] ?? "");

      const iso = isoFromProp || this.resolveIso(label);
      if (!iso) {
        console.warn(`[geo:import] субъект не распознан: ${label}`);
        continue;
      }

      const region = this.regionByIso.get(iso);
      if (!region) {
        console.warn(`[geo:import] регион не найден в БД: ${iso}`);
        continue;
      }

      const geoFeatureId = await this.upsertGeoFeature({
        layer: "subject",
        regionId: region.id,
        name: region.name,
        geometry: feature.geometry,
        sourceFileKey: path.relative(MONOREPO_ROOT, filePath),
        sourceMeta: { iso, label, priority },
      });

      // Создаём/обновляем place_geo_link для place(kind=region)
      const regionPlace = await this.places.findRegionPlaceByRegionId(region.id);
      if (regionPlace) {
        await this.upsertPlaceGeoLink(regionPlace.id, geoFeatureId, priority);
        upserted++;
      }
    }
    return upserted;
  }

  // ─── 3 + 4: Районы субъектов и городов ──────────────────────────────────────

  private async importDistricts(
    filePath: string,
    foFolder: string | null,
    layer: "district" | "city_district",
  ): Promise<{ features: number; linked: number; orphans: number }> {
    const collection = readGeoJson(filePath);
    if (!collection) return { features: 0, linked: 0, orphans: 0 };

    // Извлекаем имя региона/города из имени файла
    const regionName = extractNameFromFilename(path.basename(filePath));
    const region = this.resolveRegionByName(regionName);

    if (!region) {
      console.warn(`[geo:import] не найден регион для файла: ${path.basename(filePath)}`);
      return { features: 0, linked: 0, orphans: 0 };
    }

    let features = 0;
    let linked = 0;
    let orphans = 0;
    for (const feature of collection.features) {
      const districtName = String(
        feature.properties["district"] ?? feature.properties["name"] ?? "",
      );
      if (!districtName) continue;

      const geoFeatureId = await this.upsertGeoFeature({
        layer,
        regionId: region.id,
        name: districtName,
        geometry: feature.geometry,
        sourceFileKey: path.relative(MONOREPO_ROOT, filePath),
        sourceMeta: {
          parentRegion: region.name,
          foCode: foFolder ?? undefined,
          foName: foFolder ? (FO_CODE_TO_NAME[foFolder] ?? foFolder) : undefined,
        },
      });
      features++;

      const linkResult = await this.linkPlaceToGeoFeature({
        regionId: region.id,
        layer,
        name: districtName,
        geoFeatureId,
      });
      if (linkResult.linked) {
        linked++;
      } else {
        orphans++;
      }
    }

    return { features, linked, orphans };
  }

  // ─── 5: Федеральные округа ───────────────────────────────────────────────────

  private async importFederalDistrict(filePath: string): Promise<number> {
    const collection = readGeoJson(filePath);
    if (!collection) return 0;

    let upserted = 0;
    for (const feature of collection.features) {
      const name = String(
        feature.properties["Federal District"] ?? feature.properties["name"] ?? "",
      );
      if (!name) continue;

      await this.upsertGeoFeature({
        layer: "federal_district",
        regionId: null,
        name,
        geometry: feature.geometry,
        sourceFileKey: path.relative(MONOREPO_ROOT, filePath),
        sourceMeta: {},
      });
      upserted++;
    }
    return upserted;
  }

  // ─── Upsert geo_feature ──────────────────────────────────────────────────────

  private async upsertGeoFeature(input: {
    layer: string;
    regionId: string | null;
    name: string;
    geometry: GeoJsonGeometry;
    sourceFileKey: string;
    sourceMeta: Record<string, unknown>;
  }): Promise<string> {
    const stem = placeStem(input.name);
    const bbox  = computeBbox(input.geometry);
    const centroid = computeCentroid(bbox);

    const existing = await this.dataSource.query<Array<{ id: string }>>(`
      SELECT id FROM geo_feature
      WHERE region_id IS NOT DISTINCT FROM $1::uuid
        AND layer = $2
        AND name_stem = $3
        AND is_active = true
      LIMIT 1
    `, [input.regionId, input.layer, stem]);

    const geoFeatureId = existing[0]?.id ?? randomUUID();

    await this.dataSource.query(`
      INSERT INTO geo_feature (
        id, layer, region_id, name, name_stem,
        geometry, bbox, centroid_lat, centroid_lon,
        source_file_key, source_meta, is_active, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,now())
      ON CONFLICT (id) DO UPDATE SET
        name          = EXCLUDED.name,
        geometry      = EXCLUDED.geometry,
        bbox          = EXCLUDED.bbox,
        centroid_lat  = EXCLUDED.centroid_lat,
        centroid_lon  = EXCLUDED.centroid_lon,
        source_file_key = EXCLUDED.source_file_key,
        source_meta   = EXCLUDED.source_meta,
        updated_at    = now()
    `, [
      geoFeatureId,
      input.layer,
      input.regionId,
      input.name,
      stem,
      JSON.stringify({ type: input.geometry.type, coordinates: input.geometry.coordinates }),
      JSON.stringify(bbox),
      centroid?.lat?.toFixed(6) ?? null,
      centroid?.lon?.toFixed(6) ?? null,
      input.sourceFileKey,
      JSON.stringify(input.sourceMeta),
    ]);

    return geoFeatureId;
  }

  // ─── Link geometry к существующему place ─────────────────────────────────────

  /**
   * Ищет place по fias → oktmo → region+kind+stem и проставляет geo_feature_id.
   * Новые places из OSM не создаём.
   */
  private async linkPlaceToGeoFeature(input: {
    regionId: string;
    layer: "district" | "city_district";
    name: string;
    geoFeatureId: string;
    fiasId?: string;
    oktmo?: string;
  }): Promise<{ linked: boolean }> {
    const place = await this.resolvePlaceForGeometry(input);
    if (!place) {
      return { linked: false };
    }

    const stem = placeStem(input.name);
    // geometry_artifact_key не трогаем: FK → geo_dataset_file, геометрия в geo_feature.
    await this.dataSource.query(
      `
      UPDATE places SET
        geo_feature_id = COALESCE(geo_feature_id, $1::uuid),
        name_stem = COALESCE(NULLIF(name_stem, ''), $2),
        updated_at = now()
      WHERE id = $3::uuid
      `,
      [input.geoFeatureId, stem, place.id],
    );

    return { linked: true };
  }

  /** Каскад geometry lookup: fias → oktmo → region+kind+stem. */
  private async resolvePlaceForGeometry(input: {
    regionId: string;
    layer: "district" | "city_district";
    name: string;
    fiasId?: string;
    oktmo?: string;
  }): Promise<PlaceRecord | null> {
    if (input.fiasId) {
      const byFias = await this.places.findByFias(input.fiasId);
      if (byFias && byFias.regionId === input.regionId) {
        return byFias;
      }
    }

    if (input.oktmo) {
      const byOktmo = await this.places.findByOktmoInRegion(
        input.regionId,
        input.oktmo,
      );
      if (byOktmo) {
        return byOktmo;
      }
    }

    const stem = placeStem(input.name);
    for (const kind of geometryLinkFallbackKinds(input.layer)) {
      const byStem = await this.places.findByStemInRegion(
        stem,
        input.regionId,
        kind,
      );
      if (byStem) {
        return byStem;
      }
    }

    return null;
  }

  // ─── Upsert place_geo_link ───────────────────────────────────────────────────

  private async upsertPlaceGeoLink(
    placeId: string,
    geoFeatureId: string,
    priority: number,
  ): Promise<void> {
    await this.dataSource.query(`
      INSERT INTO place_geo_link (id, place_id, geo_feature_id, role, priority)
      VALUES ($1, $2, $3, 'boundary', $4)
      ON CONFLICT (place_id, geo_feature_id) DO UPDATE SET priority = EXCLUDED.priority
    `, [randomUUID(), placeId, geoFeatureId, priority]);
  }

  // ─── Lookup helpers ──────────────────────────────────────────────────────────

  private resolveIso(label: string): string | undefined {
    return this.geometryCatalog.resolveIsoForTest(label);
  }

  private resolveRegionByName(name: string): RegionRecord | undefined {
    const iso = this.resolveIso(name);
    if (iso) {
      return this.regionByIso.get(iso);
    }

    const stem = placeStem(name);
    for (const region of this.regionByIso.values()) {
      if (placeStem(region.name) === stem) return region;
      if (region.nameWithType && placeStem(region.nameWithType) === stem) return region;
      if (region.shortName && placeStem(region.shortName) === stem) return region;
    }
    return undefined;
  }
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────

/**
 * Извлекает русское название из имени файла вида `{Рус название}_{EN name}.geojson`.
 * Если символ `_` отсутствует — возвращает всё имя без расширения.
 */
function extractNameFromFilename(filename: string): string {
  const base = filename.replace(/\.geojson$/i, "");
  const underscoreIdx = base.indexOf("_");
  return underscoreIdx > 0 ? base.slice(0, underscoreIdx).trim() : base.trim();
}

/** Читает GeoJSON-файл; возвращает null если файл не существует или не валиден. */
function readGeoJson(filePath: string): GeoJsonCollection | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as GeoJsonCollection;
    if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) return null;
    return parsed;
  } catch {
    console.warn(`[geo:import] не удалось прочитать ${filePath}`);
    return null;
  }
}

/** Безопасно читает директорию; пустой массив при ошибке. */
function readdirSafe(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath);
}

/** Вычисляет bbox [w,s,e,n] из GeoJSON геометрии (только Polygon/MultiPolygon). */
function computeBbox(geometry: GeoJsonGeometry): BboxTuple | null {
  const coords = flattenCoordinates(geometry);
  if (coords.length === 0) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

/** Вычисляет центроид как середину bbox. */
function computeCentroid(bbox: BboxTuple | null): { lat: number; lon: number } | null {
  if (!bbox) return null;
  return { lat: (bbox[1] + bbox[3]) / 2, lon: (bbox[0] + bbox[2]) / 2 };
}

/** Разворачивает Polygon/MultiPolygon в плоский список [lon, lat]. */
function flattenCoordinates(geometry: GeoJsonGeometry): Array<[number, number]> {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as number[][][];
    return rings.flat() as Array<[number, number]>;
  }
  if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates as number[][][][];
    return polys.flat(2) as Array<[number, number]>;
  }
  return [];
}
