/**
 * Единая точка geo catalog import: tabular → frontline → osm_geometry → adjacency.
 * Запуск: npm run geo:catalog:import -w @radar/api
 */
import * as path from "node:path";
import * as dotenv from "dotenv";
import type { DataSource } from "typeorm";
import dataSource from "../../data-source";
import { GeoCatalogImportService } from "../../application/geo-catalog/geo-catalog-import.service";
import type {
  GeoCatalogStepStats,
  IGeoCatalogImportReporter,
} from "../../application/geo-catalog/geo-catalog.reporter.port";
import { createGeoSyncPersistReporter } from "../geo-sync/geoSyncCliProgress";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

type CliMode = "import" | "plan";

function parseMode(): CliMode {
  const command = (process.argv[2] ?? "import").toLowerCase();
  if (command === "plan") return "plan";
  return "import";
}

function formatStep(stats: GeoCatalogStepStats): string {
  const parts = [`[${stats.step}]`];
  if (stats.regions !== undefined) parts.push(`regions=${stats.regions}`);
  if (stats.places !== undefined) parts.push(`places=${stats.places}`);
  if (stats.aliases !== undefined) parts.push(`aliases=${stats.aliases}`);
  if (stats.features !== undefined) parts.push(`features=${stats.features}`);
  if (stats.linked !== undefined) parts.push(`linked=${stats.linked}`);
  if (stats.orphans !== undefined) parts.push(`orphans=${stats.orphans}`);
  if (stats.edges !== undefined) parts.push(`edges=${stats.edges}`);
  parts.push(`(${(stats.durationMs / 1000).toFixed(1)}s)`);

  const debug = stats.debug;
  if (debug) {
    const dbTotal = debug.dbPlacesByKind
      ? Object.values(debug.dbPlacesByKind).reduce((sum, n) => sum + n, 0)
      : undefined;
    const debugParts: string[] = [];
    if (debug.snapshotPlaces !== undefined) {
      debugParts.push(`snapshot=${debug.snapshotPlaces}`);
    }
    if (debug.placeRowsBuilt !== undefined) {
      debugParts.push(`rows=${debug.placeRowsBuilt}`);
    }
    if (debug.unresolvedPlaceDrafts !== undefined && debug.unresolvedPlaceDrafts > 0) {
      debugParts.push(`unresolved=${debug.unresolvedPlaceDrafts}`);
    }
    if (debug.planPlaces) {
      debugParts.push(
        `plan=+${debug.planPlaces.added}/~${debug.planPlaces.updated}/=${debug.planPlaces.noop}`,
      );
    }
    if (dbTotal !== undefined) {
      debugParts.push(`db=${dbTotal}`);
    }
    if (debug.dbPlacesByKind) {
      const kinds = Object.entries(debug.dbPlacesByKind)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([kind, count]) => `${kind}:${count}`)
        .join(",");
      debugParts.push(`byKind={${kinds}}`);
    }
    if (debugParts.length > 0) {
      parts.push(`| ${debugParts.join(" ")}`);
    }
  }

  return parts.join(" ");
}

function createConsoleReporter(mode: CliMode): IGeoCatalogImportReporter {
  return {
    stepBegin(step, index, total) {
      console.log(`[geo:catalog:${mode}] [${index}/${total}] ${step}...`);
    },
    stepDone(stats) {
      console.log(`[geo:catalog:${mode}] ${formatStep(stats)}`);
    },
    finish(steps) {
      const totalMs = steps.reduce((sum, step) => sum + step.durationMs, 0);
      console.log(`[geo:catalog:${mode}] done (${(totalMs / 1000).toFixed(1)}s)`);
    },
  };
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
  const mode = parseMode();
  await withDataSource(dataSource, async () => {
    const service = new GeoCatalogImportService({
      dataSource,
      reporter: createConsoleReporter(mode),
      persist: mode === "import" ? createGeoSyncPersistReporter() : undefined,
    });
    const result = await service.run(mode);
    console.log(JSON.stringify(result, null, 2));
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
