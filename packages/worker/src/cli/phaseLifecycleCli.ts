import { MONOREPO_ROOT } from "@repo/root";
import { wipeFullDataStack } from "../application/phases/lifecycle/fullStackWipe.js";
import { wipeGeoCatalogPhase } from "../application/phases/lifecycle/geoCatalogPhase.js";
import { resetGeoEnrichmentPhase, wipeGeoPlacesPhase } from "../application/phases/lifecycle/geoPhase.js";
import { resetIngestPhase, wipeIngestPhase } from "../application/phases/lifecycle/ingestPhase.js";
import { wipeIngestParsePhase } from "../application/phases/lifecycle/ingestParsePhase.js";
import { resetParsePhase, wipeParsePhase } from "../application/phases/lifecycle/parsePhase.js";
import { clearPhaseQueues, type PhaseQueueScope } from "../application/phases/lifecycle/phaseQueues.js";
import {
  createPhaseOperationalDeps,
  type PhaseOperationalDeps,
} from "../application/phases/phaseOperationalDeps.js";
import type { PhaseMutationResult } from "../application/phases/lifecycle/phaseLifecycle.types.js";
import { buildTestPlaceScanService } from "../domain/parse/geo/testPlaceScanFixture.js";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { notifyMapPushSnapshot } from "../infrastructure/notifyMapPushSnapshot.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { hasAnyFlag, parseLongFlagsMap, parsePositionalArgs } from "./workerCliArgs.js";

/** Ключи полного wipe БД (ingest + places + geo-catalog). */
const FULL_SYSTEM_WIPE_KEYS = new Set(["system", "vendor-ingest-parse-geo"]);

const PHASE_HELP: Record<string, string> = {
  ingest: "raw + производные parse; places не трогает",
  parse: "parsed/evloc; raw остаётся",
  geo: "places + aliases; geo_feature/regions остаются",
  "geo-catalog": "regions + geo_feature + geo_dataset_file (БД)",
  "ingest-parse": "ingest:wipe (raw + всё до places)",
  system: "полный wipe контента БД (raw + parsed + places + regions)",
  "vendor-ingest-parse-geo": "устарело → system wipe",
};

function printUsage(): void {
  console.log(`
Фазовые команды (wipe | reset | clear):

  npm run <phase>:<action> -- [--dry-run] [--confirm]

  ingest:wipe | ingest:reset
  parse:wipe  | parse:reset
  geo:wipe    | geo:reset
  geo-catalog:wipe
  ingest-parse:wipe
  system:wipe  (--confirm обязателен; предпочтительно: npm run radar -- system wipe)

  Устарело: vendor-ingest-parse-geo:wipe → system:wipe

  phase:ingest:clear | phase:geo:clear | phase:all:clear

Семантика:
  wipe  — до состояния «фаза раскатана, контент пуст»
  reset — только обогащение (ingest/parse: noop)
  clear — только очереди фаз

run-команды (без изменений):
  vendor:run → geo:vendor + geo:sync
  geo:run    → geo:regions:seed + geo:features:import
  parse:run  → parse-engine:rebuild:drain
`);
}

function printResult(result: PhaseMutationResult): void {
  console.log(`\n[${result.phase}:${result.action}]${result.dryRun ? " (dry-run)" : ""}`);
  for (const [k, v] of Object.entries(result.counts)) {
    console.log(`  ${k}: ${v}`);
  }
  for (const note of result.notes ?? []) {
    console.log(`  · ${note}`);
  }
}

function needsConfirm(phaseKey: string, action: string): boolean {
  return FULL_SYSTEM_WIPE_KEYS.has(phaseKey) && action === "wipe";
}

function warnDeprecatedFullWipeKey(phaseKey: string): void {
  if (phaseKey !== "vendor-ingest-parse-geo") return;
  console.warn(
    "⚠ vendor-ingest-parse-geo устарел — используйте: npm run radar -- system wipe -- --confirm",
  );
}

type PhaseDbCtx = { deps: PhaseOperationalDeps };

function lifecycleRuntime(phaseKey: string) {
  const extra = { placeScan: buildTestPlaceScanService([]) };
  switch (phaseKey) {
    case "ingest":
      return cliWorkerRuntime("ingest", ["ingest"], extra);
    case "parse":
      return cliWorkerRuntime("parse", ["parse"], extra);
    case "geo":
    case "geo-catalog":
      return cliWorkerRuntime("geo", ["geo"], extra);
    case "ingest-parse":
      return cliWorkerRuntime("parse", ["ingest", "parse"], extra);
    default:
      return cliWorkerRuntime("parse", ["ingest", "parse", "geo"], extra);
  }
}

/** План или выполнение мутации фазы (dry-run не требует БД). */
async function runPhaseMutation(
  phaseKey: string,
  action: string,
  ctx: PhaseDbCtx | null,
  dryRun: boolean,
): Promise<PhaseMutationResult[]> {
  const deps = ctx?.deps;

  if (phaseKey === "clear" && (action === "ingest" || action === "geo" || action === "all")) {
    return [
      await clearPhaseQueues({
        deps: deps!,
        scope: action as PhaseQueueScope,
        dryRun,
      }),
    ];
  }

  switch (`${phaseKey}:${action}`) {
    case "ingest:wipe":
      return [await wipeIngestPhase({ deps: deps!, dryRun })];
    case "parse:wipe":
      return [await wipeParsePhase({ deps: deps!, dryRun })];
    case "geo:wipe":
      return [await wipeGeoPlacesPhase({ deps: deps!, dryRun })];
    case "geo:reset":
      return [await resetGeoEnrichmentPhase({ deps: deps!, dryRun })];
    case "geo-catalog:wipe":
      return [await wipeGeoCatalogPhase({ operationalSql: deps!.operationalSql, dryRun })];
    case "ingest-parse:wipe":
      return [await wipeIngestParsePhase({ deps: deps!, dryRun })];
    case "system:wipe":
    case "vendor-ingest-parse-geo:wipe":
      return (await wipeFullDataStack({ deps: deps!, dryRun })).steps;
    default:
      return [];
  }
}

function isConfirmed(flags: ReturnType<typeof parseLongFlagsMap>): boolean {
  if (hasAnyFlag(flags, ["confirm", "yes", "y"])) {
    return true;
  }
  const raw = process.env.RADAR_CONFIRM_SYSTEM_WIPE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const positionals = parsePositionalArgs(process.argv);
  const dryRun = hasAnyFlag(flags, ["dry-run", "dryRun", "dry"]);

  if (hasAnyFlag(flags, ["help", "h"]) || positionals.length < 2) {
    printUsage();
    process.exit(positionals.length < 2 ? 1 : 0);
  }

  const phaseKey = positionals[0]!.toLowerCase();
  const action = positionals[1]!.toLowerCase();

  warnDeprecatedFullWipeKey(phaseKey);

  if (needsConfirm(phaseKey, action) && !dryRun && !isConfirmed(flags)) {
    console.error("Добавьте --confirm для полного wipe.");
    process.exit(1);
  }

  if (action === "reset" && (phaseKey === "ingest" || phaseKey === "parse")) {
    printResult(phaseKey === "ingest" ? resetIngestPhase(dryRun) : resetParsePhase(dryRun));
    process.exit(0);
  }

  if (dryRun) {
    const planned = await runPhaseMutation(phaseKey, action, null, true);
    if (planned.length === 0) {
      console.error(`Неизвестно: ${phaseKey}:${action}`);
      if (PHASE_HELP[phaseKey]) console.error(`Подсказка: ${PHASE_HELP[phaseKey]}`);
      printUsage();
      process.exit(1);
    }
    for (const r of planned) printResult(r);
    process.exit(0);
  }

  const runtime = await createWorkerCompositionRoot(lifecycleRuntime(phaseKey));

  if (!runtime.operationalSql || !runtime.workerRepos) {
    console.error("Нужен RADAR_STORAGE_MODE=db и DATABASE_URL");
    process.exit(1);
  }

  const ctx: PhaseDbCtx = {
    deps: createPhaseOperationalDeps(runtime.operationalSql, runtime.workerRepos),
  };

  const results = await runPhaseMutation(phaseKey, action, ctx, false);
  if (results.length === 0) {
    console.error(`Неизвестно: ${phaseKey}:${action}`);
    if (PHASE_HELP[phaseKey]) console.error(`Подсказка: ${PHASE_HELP[phaseKey]}`);
    printUsage();
    process.exit(1);
  }

  for (const r of results) {
    printResult(r);
  }

  await notifyMapPushSnapshot();
  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
