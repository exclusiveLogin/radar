import type { WipeStepOptions } from "../../archive/wipeStepReporter.js";
import type { PhaseOperationalDeps } from "../phaseOperationalDeps.js";
import { wipeIngestPhase } from "./ingestPhase.js";
import type { PhaseMutationResult } from "./phaseLifecycle.types.js";

/** ingest-parse:wipe = ingest:wipe (raw + все производные parse). */
export async function wipeIngestParsePhase(
  input: {
    deps: PhaseOperationalDeps;
    dryRun: boolean;
  } & WipeStepOptions,
): Promise<PhaseMutationResult> {
  const r = await wipeIngestPhase(input);
  return { ...r, phase: "ingest-parse" };
}
