import type { DataSource } from "typeorm";
import dataSource from "../../data-source";
import { GeoSyncApplyService } from "../../application/geo-sync/geo-sync-apply.service";
import { GeoSyncPlanService } from "../../application/geo-sync/geo-sync-plan.service";
import { CompositeGeoProvider, AllCitiesFiasCatalogProvider, RussiaGeoJsonOsmProvider } from "../../infrastructure/geo-providers";
import { TypeOrmDomainEventRepository } from "../../infrastructure/persistence/typeorm-domain-event.repository";
import { TypeOrmPlaceAliasRepository } from "../../infrastructure/persistence/typeorm-place-alias.repository";
import { TypeOrmPlaceRepository } from "../../infrastructure/persistence/typeorm-place.repository";
import { TypeOrmRegionRepository } from "../../infrastructure/persistence/typeorm-region.repository";
import { TypeOrmSyncAuditRepository } from "../../infrastructure/persistence/typeorm-sync-audit.repository";
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

function buildGeoProvider(): CompositeGeoProvider {
  return new CompositeGeoProvider([
    new RussiaGeoJsonOsmProvider(),
    new AllCitiesFiasCatalogProvider(),
  ]);
}

async function run(): Promise<void> {
  const mode = parseMode();
  await withDataSource(dataSource, async () => {
    const provider = buildGeoProvider();
    const regions = new TypeOrmRegionRepository(dataSource);
    const places = new TypeOrmPlaceRepository(dataSource);
    const aliases = new TypeOrmPlaceAliasRepository(dataSource);
    const audit = new TypeOrmSyncAuditRepository(dataSource);
    const events = new TypeOrmDomainEventRepository(dataSource);
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
        const result = await service.apply({
          persist: createGeoSyncPersistReporter(),
          snapshot: snapshotUi.reporter,
        });
        console.log(JSON.stringify({ mode, result }, null, 2));
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
