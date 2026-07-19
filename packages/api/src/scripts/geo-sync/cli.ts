import type { DataSource } from "typeorm";
import dataSource from "../../data-source";
import { GeoSyncApplyService } from "../../application/geo-sync/geo-sync-apply.service";
import { GeoSyncPlanService } from "../../application/geo-sync/geo-sync-plan.service";
import { CompositeGeoProvider } from "../../infrastructure/geo-providers";
import {
  FrontlineCatalogProvider,
  TabularCatalogProvider,
} from "../../infrastructure/geo-catalog";
import { createGeoSyncPersistenceDeps } from "../../infrastructure/geo-sync/createGeoSyncPersistenceDeps";
import {
  createGeoSyncPersistReporter,
  createGeoSyncSnapshotReporter,
} from "./geoSyncCliProgress";

type CliMode = "plan" | "apply";

function parseMode(): CliMode {
  const command = (process.argv[2] ?? "plan").toLowerCase();
  if (command === "apply") return "apply";
  return "plan";
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

/** Legacy geo:db:* — только catalog snapshot (tabular → frontline), без OSM drafts. */
function buildGeoProvider(): CompositeGeoProvider {
  return new CompositeGeoProvider([
    new TabularCatalogProvider(),
    new FrontlineCatalogProvider(),
  ]);
}

async function run(): Promise<void> {
  const mode = parseMode();
  await withDataSource(dataSource, async () => {
    const provider = buildGeoProvider();
    const { regions, places, aliases, audit, events } = createGeoSyncPersistenceDeps(dataSource);
    const planner = new GeoSyncPlanService(provider, regions, places, aliases);

    if (mode === "apply") {
      const snapshotUi = createGeoSyncSnapshotReporter("geo:snapshot");
      const service = new GeoSyncApplyService(
        provider,
        regions,
        places,
        aliases,
        audit,
        events,
        planner,
      );
      try {
        const { plan, persist } = await service.apply({
          persist: createGeoSyncPersistReporter(),
          snapshot: snapshotUi.reporter,
        });
        console.log(JSON.stringify({ mode, plan, persist }, null, 2));
      } finally {
        snapshotUi.stop();
      }
      return;
    }

    const snapshotUi = createGeoSyncSnapshotReporter("geo:plan");
    try {
      const result = await planner.plan({ snapshotReporter: snapshotUi.reporter });
      console.log(JSON.stringify({ mode, result }, null, 2));
    } finally {
      snapshotUi.stop();
    }
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
