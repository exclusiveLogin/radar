import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { loadRegionAdjacency } from "../infrastructure/geo-catalog/adjacencyLoader.js";
import { resolveMapStateTtlMs } from "../infrastructure/config/mapStateExpiryConfig.js";
import { MapStateExpirySweep } from "../application/map-state/mapStateExpirySweep.js";

/**
 * Одноразовый TTL-sweep (cron / ручной запуск без полного worker).
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const dataSource = await createWorkerDataSource();
  const repos = await createWorkerDbRepositories(dataSource);

  const sweep = new MapStateExpirySweep({
    regionState: repos.regionState,
    placeStatus: repos.placeStatus,
    regions: repos.regions,
    adjacency: loadRegionAdjacency(),
    ttlMs: resolveMapStateTtlMs(),
  });

  const result = await sweep.run();
  console.log("Map state expiry:", result);
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
