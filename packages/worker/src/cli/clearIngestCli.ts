import { MONOREPO_ROOT } from "@repo/root";
import { clearIngestOperationalState } from "../application/archive/clearIngestOperationalState.js";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

function printPlan(): void {
  console.log(`
parse-engine:clear:ingest — операционный сброс ingest (конфиг сохраняется):

  • job_ingest_backfill — cancel активных + DELETE всех
  • state_ingest_cursor — DELETE
  • ingest_providers.last_error — очистка
  • event_outbox (ingest_provider, ingest_binding, raw_message)

Не трогает: channels, ingest_providers/bindings (конфиг), mat_ingest_raw.
`);
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const skipEvents = hasAnyFlag(flags, ["no-domain-events", "noDomainEvents"]);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log("Usage: npm run parse-engine:clear:ingest [--dry-run] [--no-domain-events]");
    printPlan();
    process.exit(0);
  }

  printPlan();
  if (dryRun) {
    console.log("[dry-run] SQL не выполнялся.");
    process.exit(0);
  }

  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("ingest", ["ingest"]));
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
  console.log(`  event_outbox удалено: ${result.domainEventsDeleted}`);

  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
