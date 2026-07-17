import { MONOREPO_ROOT } from "@repo/root";
import { resolveGeoEnrichmentProvider } from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

const DEFAULT_ORPHAN_RUN_MS = 120_000;

function resolveOrphanRunMs(): number {
  const parsed = Number(process.env.RADAR_GEO_ORPHAN_RUN_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ORPHAN_RUN_MS;
}

/** Сброс сиротских geo runs + processing→pending (worker умер, очередь стоит). */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const force = hasAnyFlag(parseLongFlagsMap(process.argv), ["force"]);
  const runtime = await createWorkerCompositionRoot({
    workerRole: "geo",
    bootCaps: ["geo"],
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.dataSource || !runtime.workerRepos) {
    console.error("geo:recover: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const { phaseDefinitions, phaseRuns, placeEnrichmentJobs } = runtime.workerRepos;
  const geoPhases = (await phaseDefinitions.listAll()).filter((p) => p.scope === "geoParse");
  const orphanMs = force ? 1 : resolveOrphanRunMs();

  for (const phase of geoPhases) {
    const provider = resolveGeoEnrichmentProvider(phase);
    if (!provider) continue;

    const before = await phaseRuns.findActiveForPhase(phase.id);
    let failed = await phaseRuns.failStaleActiveRuns(phase.id, orphanMs);
    if (force && before) {
      await phaseRuns.updateStatus(before.id, "failed", {
        error: "geo:recover --force (ручной сброс зависшего run)",
      });
      failed += 1;
    }
    const reset = failed > 0 ? await placeEnrichmentJobs.resetProcessingForProvider(provider) : 0;
    const after = await phaseRuns.findActiveForPhase(phase.id);

    console.log(
      `[${phase.id}] activeBefore=${before?.id ?? "—"} failedRuns=${failed} processing→pending=${reset} activeAfter=${after?.id ?? "—"}`,
    );
  }

  await runtime.shutdown?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
