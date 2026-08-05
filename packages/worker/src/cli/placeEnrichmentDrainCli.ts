import { MONOREPO_ROOT } from "@repo/root";
import type { PlaceEnrichmentProvider } from "@radar/shared";
import { phaseWakesOnSchedule, resolveGeoEnrichmentProvider } from "@radar/shared";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { runGeoPhaseDrain } from "../application/geo-parse/runGeoPhaseDrain.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
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

/** One-shot drain scheduled geoParse через runGeoPhaseDrain (+ phase_run session). */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const phaseFilter = readStringFlag(flags, ["phase"])?.trim();
  const providerFilter = readStringFlag(flags, ["provider"])?.trim();

  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("geo", ["geo"]));
  if (!runtime.workerRepos || !runtime.placeEnrichmentRunner || !runtime.phaseRunSession) {
    throw new Error("parse-engine:geo:drain: требуется db mode + session");
  }

  let geoPhases = (
    await runtime.workerRepos.phaseDefinitions.listEnabled(undefined, "geoParse")
  ).filter((phase) => phaseWakesOnSchedule(phase.triggerMode));
  if (phaseFilter) {
    geoPhases = geoPhases.filter((phase) => phase.id === phaseFilter);
    if (geoPhases.length === 0) {
      throw new Error(`schedule-capable geoParse фаза '${phaseFilter}' не найдена`);
    }
  }

  for (const phase of geoPhases) {
    const provider =
      resolveProvider(phase.enrichers, providerFilter) ?? resolveGeoEnrichmentProvider(phase);
    if (!provider) continue;

    const run = await runtime.workerRepos.phaseRuns.create({
      phaseId: phase.id,
      trigger: "manual",
    });
    const result = await runGeoPhaseDrain(
      {
        placeEnrichmentRunner: runtime.placeEnrichmentRunner,
        placeEnrichmentJobs: runtime.workerRepos.placeEnrichmentJobs,
        session: runtime.phaseRunSession,
      },
      {
        phase,
        runId: run.id,
        batchSize: phase.policy.batchSize,
        trigger: "manual",
      },
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
