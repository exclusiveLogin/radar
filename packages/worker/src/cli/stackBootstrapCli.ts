import "reflect-metadata";
import { MONOREPO_ROOT } from "@repo/root";
import { loadDeploymentManifest } from "@radar/shared/deployment/deploymentManifest.loader.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import {
  seedPhasesFromManifest,
  type ManifestSeedMode,
} from "../infrastructure/manifest/manifestSeed.js";
import { parsePositionalArgs } from "./workerCliArgs.js";

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const modeArg = parsePositionalArgs(process.argv)[0];
  const mode: ManifestSeedMode = modeArg === "apply-config" ? "apply-config" : "insert-only";

  const manifest = loadDeploymentManifest({ repoRoot: MONOREPO_ROOT });
  const dataSource = await createWorkerDataSource();
  const db = await createWorkerDbRepositories(dataSource);

  try {
    const result = await seedPhasesFromManifest(manifest, db.phaseDefinitions, mode);
    console.log(`Stack bootstrap (${mode}):`, result, `(${manifest.phases.length} in manifest)`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
