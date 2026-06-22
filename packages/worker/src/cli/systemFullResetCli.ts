import { MONOREPO_ROOT } from "@repo/root";
import { wipeFullDataStack } from "../application/phases/lifecycle/fullStackWipe.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { notifyMapPushSnapshot } from "../infrastructure/notifyMapPushSnapshot.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";
import { createSystemWipeReporter } from "./systemWipeCliProgress.js";

/** Подтверждение из argv или RADAR_CONFIRM_SYSTEM_WIPE. */
function isWipeConfirmed(flags: ReturnType<typeof parseLongFlagsMap>): boolean {
  if (hasAnyFlag(flags, ["confirm", "yes", "y"])) {
    return true;
  }
  const raw = process.env.RADAR_CONFIRM_SYSTEM_WIPE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function printHelp(): void {
  console.log(`Usage: npm run radar -- system wipe -- --confirm [--dry-run] [--verbose] [--no-force-locks]
       или: npm run system:wipe -- --confirm

  Полный wipe контента БД (без конфига ingest/фаз):
    • raw_messages, parsed_events, parse_attempts, phase_runs, domain_events
    • ingest cursors/backfill
    • places, place_aliases, geo_feature, place_geo_link, geo_dataset_file, regions

  НЕ трогает: channels, ingest_providers, phase_definitions, .env

  --verbose         полный SQL в лог
  --no-force-locks  не закрывать dev/API через pg_terminate_backend (по умолчанию закрываем)

  После wipe:
    npm run geo:catalog:import -w @radar/api
    npm run parse-engine:ingest:backfill -w @radar/worker
    npm run parse-engine:rebuild:drain -w @radar/worker
`);
}

/** Полный wipe операционки + гео-каталога (без Telegram / composition root). */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const verbose = hasAnyFlag(flags, ["verbose", "v"]);
  const forceLocks = !hasAnyFlag(flags, ["no-force-locks", "noForceLocks"]);
  const confirm = isWipeConfirmed(flags);

  if (hasAnyFlag(flags, ["help", "h"])) {
    printHelp();
    process.exit(0);
  }

  if (!confirm && !dryRun) {
    console.error("Опасная операция. Добавьте --confirm (или --dry-run для просмотра).");
    printHelp();
    process.exit(1);
  }

  const reporter = createSystemWipeReporter({ verbose });

  if (!dryRun) {
    if (forceLocks) {
      reporter.log.line(
        "forceLocks: прочие подключения к БД будут закрыты (pg_terminate_backend)",
      );
    } else {
      reporter.log.line(
        "без forceLocks: остановите npm run dev / API вручную",
      );
    }
    reporter.log.printFullPlan();
  }

  reporter.log.line("подключение к БД…");
  const dataSource = await createWorkerDataSource();
  const repos = await createWorkerDbRepositories(dataSource);
  reporter.log.line("БД — ok");

  try {
    if (dryRun) {
      const { steps } = await wipeFullDataStack({
        dataSource,
        repos,
        dryRun: true,
        reporter,
      });
      reporter.log.line("dry-run — план фаз:");
      for (const step of steps) {
        reporter.log.detail(`[${step.phase}] ${step.action}`);
        for (const note of step.notes ?? []) {
          reporter.log.detail(`  • ${note}`);
        }
      }
      return;
    }

    const { steps } = await wipeFullDataStack({
      dataSource,
      repos,
      dryRun: false,
      reporter,
      forceLocks,
    });

    reporter.log.line("итого по фазам:");
    for (const step of steps) {
      reporter.log.detail(`[${step.phase}]`);
      for (const [k, v] of Object.entries(step.counts)) {
        reporter.log.detail(`  ${k}: ${v}`);
      }
    }

    await notifyMapPushSnapshot();
    reporter.log.line("Дальше: npm run geo:catalog:import -w @radar/api");
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
