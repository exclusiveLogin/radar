import { MONOREPO_ROOT } from "@repo/root";
import type { PlaceEnrichmentProvider } from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

function resolveProvider(
  enrichers: string[],
  override?: string,
): PlaceEnrichmentProvider | null {
  if (override === "llm" || override === "dadata" || override === "nominatim") {
    return override;
  }
  if (enrichers.includes("llm")) return "llm";
  if (enrichers.includes("dadata")) return "dadata";
  if (enrichers.includes("nominatim")) return "nominatim";
  return null;
}

/** One-shot drain scheduled geoParse (как тик PlaceEnrichmentDaemon). */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const phaseFilter = readStringFlag(flags, ["phase"])?.trim();
  const providerFilter = readStringFlag(flags, ["provider"])?.trim();

  const runtime = await createWorkerCompositionRoot({
    storageMode: WorkerStorageMode.Db,
    startIngestParseDaemon: false,
  });
  if (!runtime.workerRepos || !runtime.placeEnrichmentRunner) {
    throw new Error("parse-engine:geo:drain: требуется db mode");
  }

  let geoPhases = await runtime.workerRepos.phaseDefinitions.listEnabled(
    "scheduled",
    "geoParse",
  );
  if (phaseFilter) {
    geoPhases = geoPhases.filter((phase) => phase.id === phaseFilter);
    if (geoPhases.length === 0) {
      throw new Error(`scheduled geoParse фаза '${phaseFilter}' не найдена`);
    }
  }

  for (const phase of geoPhases) {
    const provider = resolveProvider(phase.enrichers, providerFilter);
    if (!provider) continue;
    const result = await runtime.placeEnrichmentRunner.runDrain(
      provider,
      phase.policy.batchSize,
    );
    console.log(
      `geo drained phase=${phase.id} provider=${provider} processed=${result.processed} failed=${result.failed}`,
    );
  }

  await runtime.shutdown?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
