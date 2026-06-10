/**
 * Сброс гео-справочника (places, regions, geo_feature, …) перед чистым import.
 *
 * npm run geo:catalog:reset -w @radar/api -- --confirm
 * npm run geo:catalog:reset -w @radar/api -- --dry-run
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import type { DataSource } from "typeorm";
import dataSource from "../../data-source";
import { GeoCatalogResetService } from "../../application/geo-catalog/geo-catalog-reset.service";
import { createGeoCatalogResetReporter } from "./geoCatalogResetCliProgress";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function isConfirmed(): boolean {
  if (hasFlag("confirm") || hasFlag("yes") || hasFlag("y")) {
    return true;
  }
  const raw = process.env.RADAR_CONFIRM_GEO_CATALOG_RESET?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function printHelp(): void {
  console.log(`Usage: npm run geo:catalog:reset -w @radar/api -- --confirm [--dry-run]

  Удаляет гео-справочник в БД:
    regions, places, place_aliases, geo_feature, place_geo_link,
    region_adjacency, geo_sync_log, geo_dataset_file

  Обнуляет event_locations.place_id (FK RESTRICT).

  НЕ трогает: raw_messages, parsed_events, ingest cursors.

  После сброса:
    npm run geo:catalog:import -w @radar/api

  Полный wipe операционки + каталога:
    npm run parse-engine:system:wipe -w @radar/worker -- --confirm
`);
}

async function withDataSource<T>(
  ds: DataSource,
  fn: () => Promise<T>,
): Promise<T> {
  if (!ds.isInitialized) {
    await ds.initialize();
  }
  try {
    return await fn();
  } finally {
    if (ds.isInitialized) {
      await ds.destroy();
    }
  }
}

async function run(): Promise<void> {
  if (hasFlag("help") || hasFlag("h")) {
    printHelp();
    return;
  }

  const dryRun = hasFlag("dry-run") || hasFlag("dryRun");
  const confirm = isConfirmed();

  if (!confirm && !dryRun) {
    console.error("Опасная операция. Добавьте --confirm или --dry-run.");
    printHelp();
    process.exit(1);
  }

  const service = new GeoCatalogResetService(dataSource);

  if (dryRun) {
    console.log("[geo:catalog:reset] dry-run — шаги:");
    for (const line of service.describe()) {
      console.log(`  ${line}`);
    }
    return;
  }

  await withDataSource(dataSource, async () => {
    const reporter = createGeoCatalogResetReporter();
    await service.run(reporter);
    console.log("\nДальше: npm run geo:catalog:import -w @radar/api");
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
