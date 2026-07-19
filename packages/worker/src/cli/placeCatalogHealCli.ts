import { MONOREPO_ROOT } from "@repo/root";
import { GeoValidationService } from "../application/parse/geoValidationService.js";
import {
  runPlaceCatalogDedup,
  runPlaceCatalogHeal,
} from "../application/parse/placeCatalogHealer.js";
import type { PlaceCatalogHealScope } from "../domain/parsing/placeCatalogHealRule.js";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { hasAnyFlag, parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

function resolveScope(flags: ReturnType<typeof parseLongFlagsMap>): PlaceCatalogHealScope {
  const raw = readStringFlag(flags, ["scope"])?.toLowerCase();
  return raw === "all" ? "all" : "candidates";
}

function resolveLimit(flags: ReturnType<typeof parseLongFlagsMap>): number | undefined {
  const raw = readStringFlag(flags, ["limit"]);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function logHealRows(
  rows: Array<{ action: string; placeName: string; placeId: string; targetPlaceId?: string }>,
  limit = 40,
): void {
  for (const row of rows.slice(0, limit)) {
    const target = row.targetPlaceId ? ` → ${row.targetPlaceId.slice(0, 8)}` : "";
    console.log(`  ${row.action} ${row.placeName.slice(0, 60)} (${row.placeId.slice(0, 8)})${target}`);
  }
  if (rows.length > limit) {
    console.log(`  ... ещё ${rows.length - limit} строк`);
  }
}

/** Catalog heal + dedup: validate битых, схлопывание дублей region+name. */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun"]);
  const dedupOnly = hasAnyFlag(flags, ["dedup"]);
  const withDedup = hasAnyFlag(flags, ["with-dedup", "withDedup"]);
  const scope = resolveScope(flags);
  const limit = resolveLimit(flags);

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log(`Usage: npm run parse-engine:catalog:heal [options]

  --dedup           только dedup (region + normalized name → один канон)
  --with-dedup      dedup, затем validate-heal
  --dry-run         без UPDATE/DELETE
  --scope=candidates|all
  --limit=N`);
    process.exit(0);
  }

  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("geo", ["geo"]));
  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("catalog:heal: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const { places, regions, aliases } = runtime.workerRepos;
  const regionsById = new Map((await regions.listActive()).map((row) => [row.id, row]));

  let activePlaces = await places.listActive();
  if (limit !== undefined) {
    activePlaces = activePlaces.slice(0, limit);
  }

  const runDedup = dedupOnly || withDedup;
  const runHeal = !dedupOnly;

  if (runDedup) {
    console.log(`catalog:dedup dryRun=${dryRun} batch=${activePlaces.length}`);
    const dedup = await runPlaceCatalogDedup({
      dataSource: runtime.dataSource,
      aliases,
      places: activePlaces,
      dryRun,
    });
    console.log(
      `dedup groups=${dedup.duplicateGroups} rows=${dedup.duplicateRows} deprecated=${dedup.deprecated}`,
    );
    logHealRows(dedup.rows);
    if (!dryRun && dedup.deprecated > 0) {
      activePlaces = await places.listActive();
      if (limit !== undefined) activePlaces = activePlaces.slice(0, limit);
    }
  }

  if (runHeal) {
    const validation = new GeoValidationService(regions, places, aliases);
    console.log(
      `catalog:heal scope=${scope} dryRun=${dryRun} batch=${activePlaces.length}${limit ? ` (limit=${limit})` : ""}`,
    );
    const summary = await runPlaceCatalogHeal({
      dataSource: runtime.dataSource,
      validation,
      regionsById,
      places: activePlaces,
      scope,
      dryRun,
    });
    console.log(
      `heal scanned=${summary.scanned} candidates=${summary.candidates} deprecated=${summary.deprecated} merged=${summary.merged} healthy=${summary.healthy}`,
    );
    logHealRows(summary.rows.filter((item) => item.action !== "skipped_healthy"));
  }

  if (dryRun) {
    console.log("[dry-run] SQL не выполнялся.");
  }

  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
