/**
 * Засевает таблицу regions из data/geo/catalog/regions.json и синхронизирует
 * place(kind=region) для каждого субъекта.
 *
 * Запуск: npm run geo:regions:seed  (или geo:regions:seed -w @radar/api)
 * Идемпотентен: upsert по fiasId / iso / name.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import type { RegionRecord } from "@radar/shared";
import dataSource from "../data-source";
import { TypeOrmPlaceAliasRepository } from "../infrastructure/persistence/typeorm-place-alias.repository";
import { TypeOrmPlaceRepository } from "../infrastructure/persistence/typeorm-place.repository";
import { TypeOrmRegionRepository } from "../infrastructure/persistence/typeorm-region.repository";
import { syncRegionCanonicalPlaces } from "../application/geo-sync/region-place-mirror";
import { computeFrontDistancesKm } from "../application/geo-sync/region-front-distance";
import { RegionGeometryCatalog } from "../map/region-geometry.catalog";
import { repoDataPath } from "../monorepo-root";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

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

/** Центроид субъекта по ISO; computed из геометрии приоритетнее значения каталога. */
type CentroidByIso = Map<string, { centroidLat: number; centroidLon: number }>;

/**
 * Преобразует запись каталога в RegionRecord.
 * Центроид: из геометрии (SSOT data/geo) с фолбэком на значение каталога (фронт-
 * регионы без OSM-контура). frontDistanceKm проставляется вторым проходом.
 */
function toRegionRecord(entry: CatalogRegionEntry, centroids: CentroidByIso): RegionRecord {
  const fromGeometry = centroids.get(entry.iso);
  return {
    id: randomUUID(),
    code: entry.fiasId ?? entry.iso,
    fiasId: entry.fiasId ?? undefined,
    kladrId: entry.kladrId ?? undefined,
    iso: entry.iso,
    name: entry.name,
    nameWithType: entry.nameWithType,
    shortName: entry.shortName,
    federalDistrict: entry.federalDistrict,
    centroidLat: fromGeometry?.centroidLat ?? entry.centroidLat ?? undefined,
    centroidLon: fromGeometry?.centroidLon ?? entry.centroidLon ?? undefined,
    frontRegion: entry.frontRegion ?? false,
    borderRegion: entry.borderRegion ?? false,
    sourceMeta: { source: "catalog/regions.json" },
  };
}

async function main(): Promise<void> {
  const catalogPath = repoDataPath("geo", "catalog", "regions.json");

  if (!fs.existsSync(catalogPath)) {
    console.error(`Файл не найден: ${catalogPath}`);
    console.error("Убедитесь, что data/geo/catalog/regions.json существует.");
    process.exit(1);
  }

  const raw = fs.readFileSync(catalogPath, "utf8").replace(/^\uFEFF/, "");
  const entries: CatalogRegionEntry[] = JSON.parse(raw);
  console.log(`[geo:regions:seed] Загружено записей: ${entries.length}`);

  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }

  try {
    const regions = new TypeOrmRegionRepository(dataSource);
    const places  = new TypeOrmPlaceRepository(dataSource);
    const aliases = new TypeOrmPlaceAliasRepository(dataSource);

    // Центроиды из геометрии контуров (Russia_regions.geojson + supplemental).
    const geometryCatalog = RegionGeometryCatalog.getInstance();
    geometryCatalog.bindRegions([]); // ISO-индекс наполнится из catalog/regions.json
    const centroids = geometryCatalog.centroidByIso();

    const records = entries.map((entry) => toRegionRecord(entry, centroids));

    // Второй проход: дистанция до ближайшего фронт-региона по центроидам.
    const distances = computeFrontDistancesKm(
      records.map((r) => ({
        iso: r.iso ?? r.code,
        centroidLat: r.centroidLat,
        centroidLon: r.centroidLon,
        frontRegion: r.frontRegion,
      })),
    );
    for (const record of records) {
      record.frontDistanceKm = distances.get(record.iso ?? record.code) ?? null;
    }

    const withCentroid = records.filter((r) => r.centroidLat !== undefined).length;
    const withDistance = records.filter((r) => r.frontDistanceKm != null).length;
    console.log(
      `[geo:regions:seed] Центроиды: ${withCentroid}/${records.length}, ` +
        `front_distance_km: ${withDistance}/${records.length}`,
    );

    await regions.upsertMany(records);
    console.log(`[geo:regions:seed] Upserted регионов: ${records.length}`);

    const placeMap = await syncRegionCanonicalPlaces(regions, places, aliases);
    console.log(`[geo:regions:seed] place(kind=region) синхронизировано: ${placeMap.size}`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
