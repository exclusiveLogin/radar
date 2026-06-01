import { MONOREPO_ROOT } from "@repo/root";
import { clearIngestOperationalState } from "../application/archive/clearIngestOperationalState.js";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

function printPlan(): void {
  console.log(`
clear:ingest — операционный сброс ingest (конфиг сохраняется):

  • ingest_backfill_jobs — cancel активных + DELETE всех
  • ingest_cursors — DELETE
  • ingest_providers.last_error — очистка
  • domain_events (ingest_provider, ingest_binding, raw_message)

Не трогает: channels, ingest_providers/bindings (конфиг), raw_messages.
`);
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const skipEvents = hasAnyFlag(flags, ["no-domain-events", "noDomainEvents"]);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log("Usage: npm run clear:ingest [--dry-run] [--no-domain-events]");
    printPlan();
    process.exit(0);
  }

  printPlan();
  if (dryRun) {
    console.log("[dry-run] SQL не выполнялся.");
    process.exit(0);
  }

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startPhaseDaemon: false,
  });
  if (!runtime.dataSource) {
    console.error("clear:ingest: нужен RADAR_STORAGE_MODE=db и DATABASE_URL");
    process.exit(1);
  }

  const result = await clearIngestOperationalState(runtime.dataSource, {
    includeDomainEvents: !skipEvents,
  });

  console.log("\nРезультат clear:ingest:");
  console.log(`  backfill cancel (pending/running): ${result.backfillJobsCanceled}`);
  console.log(`  backfill jobs удалено: ${result.backfillJobsDeleted}`);
  console.log(`  cursors удалено: ${result.cursorsDeleted}`);
  console.log(`  provider last_error сброшено: ${result.providersErrorsCleared}`);
  console.log(`  domain_events удалено: ${result.domainEventsDeleted}`);

  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
