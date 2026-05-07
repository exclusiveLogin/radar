import type { DataSource } from "typeorm";
import dataSource from "../../data-source";
import { GeoSyncApplyService } from "../../application/geo-sync/geo-sync-apply.service";
import { GeoSyncPlanService } from "../../application/geo-sync/geo-sync-plan.service";
import {
  CompositeGeoProvider,
  DictionariesOverrideProvider,
  HflabsRegionProvider,
  RnekrasovGeoJsonProvider,
  RussiaGeoJsonOsmProvider,
} from "../../infrastructure/geo-providers";
import {
  TypeOrmDomainEventRepository,
  TypeOrmPlaceAliasRepository,
  TypeOrmPlaceRepository,
  TypeOrmRegionRepository,
  TypeOrmSyncAuditRepository,
} from "../../infrastructure/persistence";

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
  // CLI-контур работает напрямую с TypeORM DataSource
  // и не зависит от HTTP/Nest runtime.
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
    // Композитный provider объединяет несколько источников artifacts
    // в единый snapshot для дальнейшего plan/apply.
    const provider = new CompositeGeoProvider([
      new DictionariesOverrideProvider(),
      new HflabsRegionProvider(),
      new RussiaGeoJsonOsmProvider(),
      new RnekrasovGeoJsonProvider(),
    ]);
    const regions = new TypeOrmRegionRepository(dataSource);
    const places = new TypeOrmPlaceRepository(dataSource);
    const aliases = new TypeOrmPlaceAliasRepository(dataSource);
    const audit = new TypeOrmSyncAuditRepository(dataSource);
    const events = new TypeOrmDomainEventRepository(dataSource);

    if (mode === "apply") {
      // apply: пытается применить snapshot в БД и пишет audit.
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

    // plan: dry-run diff без фактической записи изменений.
    const service = new GeoSyncPlanService(provider, regions, places, aliases);
    const result = await service.plan();
    console.log(JSON.stringify({ mode, result }, null, 2));
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
