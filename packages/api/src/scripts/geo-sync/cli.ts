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

async function run(): Promise<void> {
  const mode = parseMode();
  await withDataSource(dataSource, async () => {
    // Геометрия — Russia_geojson_OSM; города/ПГТ/РП — FIAS xlsx; регионы — regions.json через geo:regions:seed.
    const provider = new CompositeGeoProvider([
      new RussiaGeoJsonOsmProvider(),
      new AllCitiesFiasCatalogProvider(),
    ]);
    const regions = new TypeOrmRegionRepository(dataSource);
    const places = new TypeOrmPlaceRepository(dataSource);
    const aliases = new TypeOrmPlaceAliasRepository(dataSource);
    const audit = new TypeOrmSyncAuditRepository(dataSource);
    const events = new TypeOrmDomainEventRepository(dataSource);

    if (mode === "apply") {
      const service = new GeoSyncApplyService(
        provider,
        regions,
        places,
        aliases,
        audit,
        events,
      );
      const result = await service.apply();
      console.log(JSON.stringify({ mode, result }, null, 2));
      return;
    }

    const service = new GeoSyncPlanService(provider, regions, places, aliases);
    const result = await service.plan();
    console.log(JSON.stringify({ mode, result }, null, 2));
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
