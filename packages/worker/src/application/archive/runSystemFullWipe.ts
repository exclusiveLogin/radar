import type { DataSource } from "typeorm";
import type { WorkerDbRepositories } from "../../infrastructure/persistence/workerDbRepos.types.js";
import { wipeFullDataStack } from "../phases/lifecycle/fullStackWipe.js";

export type RunSystemFullWipeResult = Awaited<ReturnType<typeof wipeFullDataStack>>;

/** @deprecated Используйте wipeFullDataStack / system:wipe */
export async function runSystemFullWipe(input: {
  dataSource: DataSource;
  repos: WorkerDbRepositories;
}): Promise<RunSystemFullWipeResult> {
  return wipeFullDataStack({
    dataSource: input.dataSource,
    repos: input.repos,
    dryRun: false,
  });
}
