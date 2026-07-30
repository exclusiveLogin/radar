import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

/** Планирует отсутствующие raw и разбирает enabled ingestParse-фазы батчами. */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const phaseFilter = readStringFlag(parseLongFlagsMap(process.argv), ["phase"])?.trim();

  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("parse", ["parse"]));
  if (!runtime.workerRepos || !runtime.phaseRunner) {
    throw new Error("parse-engine:ingest:drain: требуется db mode");
  }

  let phases = await runtime.workerRepos.phaseDefinitions.listEnabled(undefined, "ingestParse");
  if (phaseFilter) {
    phases = phases.filter((phase) => phase.id === phaseFilter);
    if (phases.length === 0) {
      throw new Error(`scheduled ingestParse фаза '${phaseFilter}' не найдена`);
    }
  }

  for (const phase of phases) {
    const { enqueued } = await runtime.workerRepos.phaseCoverage.enqueueCatchUp(phase.id);
    const run = await runtime.workerRepos.phaseRuns.create({
      phaseId: phase.id,
      trigger: "manual",
    });
    await runtime.phaseRunner.runDrain({
      phase,
      runId: run.id,
      trigger: "manual",
      batchSize: phase.policy.batchSize,
    });
    console.log(`ingest drained phase=${phase.id} enqueued=${enqueued}`);
  }

  await runtime.shutdown?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
