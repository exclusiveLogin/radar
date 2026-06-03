import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../../infrastructure/persistence/workerDbRepos.types.js";
import { wipeIngestPhase } from "./ingestPhase.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";

/** ingest-parse:wipe = ingest:wipe (raw + все производные parse). */
export async function wipeIngestParsePhase(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
  dryRun: boolean;
}): Promise<PhaseMutationResult> {
  const r = await wipeIngestPhase(input);
  return { ...r, phase: "ingest-parse" };
}
