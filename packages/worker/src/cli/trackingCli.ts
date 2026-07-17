/**
 * CLI пайплайна треков: status | rebuild | reset | enable.
 *
 * Примеры:
 *   npm run tracking:status -w @radar/worker
 *   npm run tracking:rebuild -w @radar/worker -- --since=2024-01-01T00:00:00Z
 *   npm run tracking:reset -w @radar/worker
 *   npm run tracking:enable -w @radar/worker -- --on
 */
import { MONOREPO_ROOT } from "@repo/root";
import { trackingPipelineConfigSchema, TRACKING_RESET_TRUNCATE_SQL } from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import {
  countTrackingCandidates,
  runTrackingRebuild,
} from "../application/tracking/trackingRebuildService.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

async function openDb() {
  loadRootEnv(MONOREPO_ROOT);
  const runtime = await createWorkerCompositionRoot({
    workerRole: "tracking",
    bootCaps: ["tracking"],
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.dataSource) {
    console.error("Нужен RADAR_STORAGE_MODE=db и DATABASE_URL");
    process.exit(1);
  }
  return { ds: runtime.dataSource, shutdown: runtime.shutdown };
}

async function cmdStatus(): Promise<void> {
  const { ds, shutdown } = await openDb();
  try {
    const [state] = await ds.query<
      {
        enabled: boolean;
        watermark: Record<string, unknown>;
        active_run_id: string | null;
        total_candidates: string | null;
      }[]
    >(
      `SELECT enabled, watermark, active_run_id, total_candidates
       FROM state_track_pipeline WHERE id = 'default'`,
    );
    const [{ count: tracks }] = await ds.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM mat_track`,
    );
    const [{ count: nodes }] = await ds.query<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM mat_track_node`,
    );
    const totalCandidates =
      Number(state?.total_candidates) ||
      (await countTrackingCandidates(ds, new Date()));

    console.log(JSON.stringify({
      enabled: state?.enabled ?? false,
      watermark: state?.watermark ?? {},
      activeRunId: state?.active_run_id ?? null,
      totalCandidates,
      tracks: Number(tracks),
      nodes: Number(nodes),
    }, null, 2));
  } finally {
    await shutdown?.();
  }
}

async function cmdRebuild(flags: ReturnType<typeof parseLongFlagsMap>): Promise<void> {
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const sinceRaw = flags.get("since");
  const untilRaw = flags.get("until");
  const until = untilRaw && typeof untilRaw === "string" ? new Date(untilRaw) : new Date();
  const since =
    sinceRaw && typeof sinceRaw === "string"
      ? new Date(sinceRaw)
      : new Date(until.getTime() - 24 * 60 * 60 * 1000);

  if (dryRun) {
    console.log(`[dry-run] rebuild since=${since.toISOString()} until=${until.toISOString()}`);
    return;
  }

  const { ds, shutdown } = await openDb();
  try {
    // Конфиг пайплайна (flow gate, веса, оверрайды профилей) — из состояния БД.
    const [state] = await ds.query<{ config: unknown }[]>(
      `SELECT config FROM state_track_pipeline WHERE id = 'default'`,
    );
    const config = trackingPipelineConfigSchema.parse(state?.config ?? {});
    console.log(`[tracking:rebuild] since=${since.toISOString()} until=${until.toISOString()}`);
    const result = await runTrackingRebuild(ds, { since, until, config });
    console.log("[tracking:rebuild] готово:", result);
  } finally {
    await shutdown?.();
  }
}

async function cmdReset(flags: ReturnType<typeof parseLongFlagsMap>): Promise<void> {
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  // --defaults: дополнительно сбрасывает оверрайды кинематики профилей (config.profiles)
  // к физическим дефолтам PROFILE_KINEMATICS (после правок maxLink/maxGap/σ).
  const resetKinematics = hasAnyFlag(flags, ["defaults", "kinematics"]);
  if (dryRun) {
    console.log(
      `[dry-run] ${TRACKING_RESET_TRUNCATE_SQL} + watermark={}${resetKinematics ? " + config.profiles={}" : ""}`,
    );
    return;
  }

  const { ds, shutdown } = await openDb();
  try {
    await ds.query(
      `UPDATE job_track_rebuild
       SET status = 'cancelled', finished_at = now()
       WHERE status IN ('running', 'paused')`,
    );
    await ds.query(TRACKING_RESET_TRUNCATE_SQL);
    const watermarkReset = resetKinematics
      ? `SET watermark = '{}'::jsonb, active_run_id = NULL,
         config = jsonb_set(COALESCE(config, '{}'::jsonb), '{profiles}', '{}'::jsonb),
         updated_at = now()`
      : `SET watermark = '{}'::jsonb, active_run_id = NULL, updated_at = now()`;
    await ds.query(
      `UPDATE state_track_pipeline ${watermarkReset} WHERE id = 'default'`,
    );
    console.log(
      `[tracking:reset] mat_track/nodes очищены, watermark сброшен${resetKinematics ? ", оверрайды кинематики сброшены к дефолтам" : ""}`,
    );
  } finally {
    await shutdown?.();
  }
}

async function cmdEnable(flags: ReturnType<typeof parseLongFlagsMap>): Promise<void> {
  const on = hasAnyFlag(flags, ["on", "enable"]);
  const off = hasAnyFlag(flags, ["off", "disable"]);
  if (on === off) {
    console.error("Укажите --on или --off");
    process.exit(1);
  }

  const { ds, shutdown } = await openDb();
  try {
    await ds.query(
      `UPDATE state_track_pipeline SET enabled = $1, updated_at = now() WHERE id = 'default'`,
      [on],
    );
    console.log(`[tracking:enable] daemon ${on ? "ВКЛ" : "ВЫКЛ"}`);
  } finally {
    await shutdown?.();
  }
}

function printHelp(): void {
  console.log(`
tracking CLI — пайплайн L1 треков

  npm run tracking:status -w @radar/worker
  npm run tracking:rebuild -w @radar/worker -- [--since=ISO] [--until=ISO] [--dry-run]
  npm run tracking:reset -w @radar/worker [-- --dry-run] [--defaults]
  npm run tracking:enable -w @radar/worker -- --on|--off

Через radar:
  npm run radar -- tracking status
  npm run radar -- tracking rebuild -- --since=2024-06-01T00:00:00Z
  npm run radar -- tracking reset
  npm run radar -- tracking enable -- --on

Env: WORKER__tracking__intervalMs, worker.runtime.manifest.json, RADAR_WORKER_ROLE=tracking
`);
}

async function main(): Promise<void> {
  const [sub] = process.argv.slice(2);
  const flags = parseLongFlagsMap(process.argv);

  if (!sub || sub === "help" || hasAnyFlag(flags, ["help", "h"])) {
    printHelp();
    return;
  }

  switch (sub) {
    case "status":
      await cmdStatus();
      break;
    case "rebuild":
      await cmdRebuild(flags);
      break;
    case "reset":
      await cmdReset(flags);
      break;
    case "enable":
      await cmdEnable(flags);
      break;
    default:
      console.error(`Неизвестная команда: ${sub}`);
      printHelp();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
