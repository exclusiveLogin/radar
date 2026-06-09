import { MONOREPO_ROOT } from "@repo/root";
import type { PlaceRecord } from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import {
  auditNoiseBuckets,
  runPlaceCatalogSweep,
  type PlaceSweepFilters,
} from "../application/parsing/placeCatalogSweep.js";
import { isGarbageIngestPlaceName } from "../domain/parsing/channelCityListPromo.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { hasAnyFlag, parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

function resolveLimit(flags: ReturnType<typeof parseLongFlagsMap>): number | undefined {
  const raw = readStringFlag(flags, ["limit"]);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function resolveFilters(flags: ReturnType<typeof parseLongFlagsMap>): PlaceSweepFilters {
  const anyFilter =
    hasAnyFlag(flags, ["only-miss", "onlyMiss"])
    || hasAnyFlag(flags, ["empty-dadata", "emptyDadata"])
    || hasAnyFlag(flags, ["empty-nominatim", "emptyNominatim"])
    || hasAnyFlag(flags, ["no-coords", "noCoords"])
    || hasAnyFlag(flags, ["unverified"])
    || hasAnyFlag(flags, ["garbage"])
    || hasAnyFlag(flags, ["both-miss", "bothMiss"])
    || hasAnyFlag(flags, ["unenriched"]);

  return {
    onlyMiss: hasAnyFlag(flags, ["only-miss", "onlyMiss"]),
    emptyDadata: hasAnyFlag(flags, ["empty-dadata", "emptyDadata"]),
    emptyNominatim: hasAnyFlag(flags, ["empty-nominatim", "emptyNominatim"]),
    noCoords: hasAnyFlag(flags, ["no-coords", "noCoords"]),
    unverified: hasAnyFlag(flags, ["unverified"]),
    garbage: hasAnyFlag(flags, ["garbage"]),
    bothMiss: hasAnyFlag(flags, ["both-miss", "bothMiss"]),
    unenriched: hasAnyFlag(flags, ["unenriched"]) || !anyFilter,
  };
}

async function printSampleAudit(
  places: PlaceRecord[],
  dataSource: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  regionsById: Map<string, { name: string }>,
): Promise<void> {
  const active = places.filter((p) => p.kind !== "region");
  const ids = active.map((p) => p.id);
  const jobRows = ids.length
    ? ((await dataSource.query(
        `SELECT place_id, provider, status, last_error FROM place_enrichment_jobs WHERE place_id = ANY($1::uuid[])`,
        [ids],
      )) as Array<{ place_id: string; provider: string; status: string; last_error: string | null }>)
    : [];

  const jobsByPlace = new Map<string, Array<{ provider: string; status: string; lastError?: string }>>();
  for (const row of jobRows) {
    const list = jobsByPlace.get(row.place_id) ?? [];
    list.push({ provider: row.provider, status: row.status, lastError: row.last_error ?? undefined });
    jobsByPlace.set(row.place_id, list);
  }

  const buckets = auditNoiseBuckets(active, regionsById, jobsByPlace as never);
  console.log("noise_buckets:", JSON.stringify(buckets, null, 2));

  const garbageSamples = active
    .filter((p) => !isGarbageIngestPlaceName(p.name))
    .filter((p) => {
      const name = p.name.toLowerCase();
      return /дрон|трасса|направлен|побереж|цели уничтож|обстановка|пкр|мвш|акватории|республик/i.test(name);
    })
    .slice(0, 25)
    .map((p) => p.name);
  if (garbageSamples.length > 0) {
    console.log("filter_gaps (не garbage, но похоже на шум):");
    for (const name of garbageSamples) {
      console.log(`  ? ${name.slice(0, 72)}`);
    }
  }
}

/** Прочёсывание каталога: аудит шума / prune неподтверждённых places. */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]) || !hasAnyFlag(flags, ["apply", "prune"]);
  const hardDelete = hasAnyFlag(flags, ["delete", "hard-delete", "hardDelete"]);
  const auditOnly = hasAnyFlag(flags, ["audit"]);
  const filters = resolveFilters(flags);
  const limit = resolveLimit(flags);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log(`Usage: npm run parse-engine:catalog:sweep [options]

  --audit              только noise_buckets + filter_gaps (без prune)
  --dry-run            без изменений (default)
  --apply / --prune    deprecate или delete matched
  --delete             hard DELETE (если нет event_locations), иначе deprecate
  --only-miss          job failed / :miss / нет evidence
  --empty-dadata
  --empty-nominatim
  --no-coords
  --unverified
  --garbage
  --both-miss          dadata и nominatim miss
  --unenriched         default если нет других фильтров
  --limit=N`);
    process.exit(0);
  }

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("catalog:sweep: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const places = await runtime.workerRepos.places.listActive();
  const regionsById = new Map(
    (await runtime.workerRepos.regions.listActive()).map((row) => [row.id, { name: row.name }]),
  );

  if (auditOnly) {
    await printSampleAudit(places, runtime.dataSource, regionsById);
    await runtime.shutdown?.();
    return;
  }

  const summary = await runPlaceCatalogSweep({
    dataSource: runtime.dataSource,
    places,
    regionsById,
    filters,
    limit,
    apply: !dryRun,
    hardDelete,
  });

  console.log(
    `catalog:sweep dryRun=${dryRun} delete=${hardDelete} scanned=${summary.scanned} matched=${summary.matched} pruned=${summary.pruned} deleted=${summary.deleted} deprecated=${summary.deprecated}`,
  );
  for (const row of summary.rows.slice(0, 60)) {
    console.log(
      `  [${row.reasons.join(",")}] ${row.placeName.slice(0, 64)} (${row.placeId.slice(0, 8)}) d=${row.jobs.find((j) => j.provider === "dadata")?.status ?? "-"} n=${row.jobs.find((j) => j.provider === "nominatim")?.status ?? "-"}`,
    );
  }
  if (summary.rows.length > 60) {
    console.log(`  ... ещё ${summary.rows.length - 60}`);
  }

  if (dryRun) {
    console.log("[dry-run] places не изменялись. --apply для prune.");
  }

  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
