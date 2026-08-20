import { wipeFullDataStack } from "../phases/lifecycle/fullStackWipe.js";
import type { PhaseOperationalDeps } from "../phases/phaseOperationalDeps.js";

export type RunSystemFullWipeResult = Awaited<ReturnType<typeof wipeFullDataStack>>;

/** @deprecated Используйте wipeFullDataStack / system:wipe */
export async function runSystemFullWipe(input: {
  deps: PhaseOperationalDeps;
}): Promise<RunSystemFullWipeResult> {
  return wipeFullDataStack({
    deps: input.deps,
    dryRun: false,
  });
}
