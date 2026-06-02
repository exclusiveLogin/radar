import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { resolveMapStateTtlMs } from "../infrastructure/config/mapStateExpiryConfig.js";
import { MapStateExpirySweep } from "../application/map-state/mapStateExpirySweep.js";

/**
 * Одноразовый TTL-sweep (cron / ручной запуск без полного worker).
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const dataSource = await createWorkerDataSource();

  const sweep = new MapStateExpirySweep({
    dataSource,
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
