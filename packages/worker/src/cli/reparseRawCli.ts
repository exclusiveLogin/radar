import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { MapStateFullReset } from "../application/map-state/mapStateFullReset.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";

/**
 * Перепарсить все raw_messages из БД (после фикса резолва kladr → ISO).
 * Перед прогоном — полный сброс region_state_active и place_status_active.
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
  });

  if (!runtime.dataSource || !runtime.parseRawMessageHandler) {
    console.error("reparseRawCli: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const repos = await createWorkerDbRepositories(runtime.dataSource);

  const reset = new MapStateFullReset({
    regionState: repos.regionState,
    placeStatus: repos.placeStatus,
    regions: repos.regions,
  });
  const resetResult = await reset.run();
  console.log(
    `Map state reset: places=${resetResult.placesCleared}, regions=${resetResult.regionsGrey}`,
  );

  const rows = (await runtime.dataSource.query(
    "SELECT id FROM raw_messages ORDER BY posted_at ASC",
  )) as Array<{ id: string }>;

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const raw = await repos.rawMessages.findById(row.id);
    if (!raw?.id) continue;
    try {
      await runtime.parseRawMessageHandler.handle(raw);
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(`reparse failed ${row.id}:`, err);
    }
  }

  console.log(`Reparse done: ${ok} ok, ${failed} failed, ${rows.length} total`);
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
