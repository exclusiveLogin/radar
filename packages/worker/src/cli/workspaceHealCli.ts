import type { DataSource } from "typeorm";
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createProgress } from "./progress.js";
import { hasAnyFlag, parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

type RawHealRow = {
  id: string;
  raw_text: string;
  posted_at: Date;
  channel_key: string;
};

async function listRawRows(
  dataSource: DataSource,
  channelKey: string | undefined,
  limit: number,
): Promise<RawHealRow[]> {
  if (channelKey) {
    return (await dataSource.query(
      `
        SELECT rm.id, rm.raw_text, rm.posted_at, ch.key AS channel_key
        FROM mat_ingest_raw rm
        JOIN channels ch ON ch.id = rm.channel_id AND ch.key = $1
        ORDER BY rm.posted_at DESC NULLS LAST
        LIMIT $2
      `,
      [channelKey, limit],
    )) as RawHealRow[];
  }
  return (await dataSource.query(
    `
      SELECT rm.id, rm.raw_text, rm.posted_at, ch.key AS channel_key
      FROM mat_ingest_raw rm
      JOIN channels ch ON ch.id = rm.channel_id
      ORDER BY rm.posted_at DESC NULLS LAST
      LIMIT $1
    `,
    [limit],
  )) as RawHealRow[];
}

/**
 * Heal CLI — контур heal: finalizer + sync candidateEventMap/spawnedEventIds.
 * Не wipe parsed/workspace. @see ../parse/parseWorkspaceRunModes.ts
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const purge = hasAnyFlag(flags, ["purge"]);
  const channelKey = readStringFlag(flags, ["channel"]);
  const rawId = readStringFlag(flags, ["raw-id", "rawId"]);
  const limitRaw = readStringFlag(flags, ["limit"]);
  const limit = limitRaw ? Math.max(1, Number(limitRaw) || 500) : 500;

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log(`Usage: npm run parse-engine:workspace:heal [options]

  --channel=KEY     только сообщения канала
  --raw-id=UUID     одно сообщение
  --dry-run         без записи в БД
  --purge           orphanPolicy=hard_delete
  --limit=N         макс. сообщений (default 500)`);
    process.exit(0);
  }

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.dataSource || !runtime.workspaceService) {
    console.error("workspace:heal: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const rows: RawHealRow[] = rawId
    ? ((await runtime.dataSource.query(
        `
          SELECT rm.id, rm.raw_text, rm.posted_at, ch.key AS channel_key
          FROM mat_ingest_raw rm
          JOIN channels ch ON ch.id = rm.channel_id
          WHERE rm.id = $1
        `,
        [rawId],
      )) as RawHealRow[])
    : await listRawRows(runtime.dataSource, channelKey, limit);

  if (rows.length === 0) {
    console.error("workspace:heal: mat_ingest_raw не найдены");
    process.exit(1);
  }

  const progress = createProgress("workspace:heal", rows.length);
  const totals = { inserted: 0, updated: 0, deactivated: 0, deleted: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    try {
      if (dryRun) {
        totals.skipped += 1;
        progress.tick(1);
        continue;
      }
      const result = await runtime.workspaceService.run({
        rawMessageId: row.id,
        rawText: row.raw_text,
        postedAt: row.posted_at.toISOString(),
        runKind: "heal",
        mode: "heal",
        orphanPolicy: purge ? "hard_delete" : "deactivate",
      });
      if (result.kind !== "event") {
        totals.skipped += 1;
      } else {
        totals.inserted += result.finalize.inserted;
        totals.updated += result.finalize.updated;
        totals.deactivated += result.finalize.deactivated;
        totals.deleted += result.finalize.deleted;
      }
    } catch {
      totals.failed += 1;
    }
    progress.tick(1);
  }
  progress.stop();

  console.log(
    JSON.stringify(
      {
        dryRun,
        channelKey: channelKey ?? null,
        rawId: rawId ?? null,
        processed: rows.length,
        ...totals,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
