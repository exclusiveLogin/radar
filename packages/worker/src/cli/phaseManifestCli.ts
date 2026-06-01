import "reflect-metadata";
import { MONOREPO_ROOT } from "@repo/root";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import {
  exportPhaseManifest,
  importPhaseManifest,
  loadPhaseManifest,
  writePhaseManifest,
} from "../infrastructure/manifest/phaseManifestLoader.js";
import { parsePositionalArgs } from "./workerCliArgs.js";

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const command = parsePositionalArgs(process.argv)[0];
  const dataSource = await createWorkerDataSource();
  const db = await createWorkerDbRepositories(dataSource);

  try {
    if (command === "import") {
      const manifest = loadPhaseManifest(MONOREPO_ROOT);
      if (!manifest) {
        console.error("Phase manifest не найден.");
        process.exit(1);
      }
      const stats = await importPhaseManifest(manifest, db.phaseDefinitions);
      for (const phase of manifest.phases) {
        if (!phase.enabled) continue;
        const catchUp = await db.phaseCoverage.enqueueCatchUp(phase.id);
        if (catchUp.enqueued > 0) {
          console.log(`catch-up ${phase.id}: +${catchUp.enqueued} pending`);
        }
      }
      console.log("Import OK:", stats);
      return;
    }

    if (command === "export") {
      const manifest = await exportPhaseManifest(db.phaseDefinitions);
      const out = writePhaseManifest(MONOREPO_ROOT, manifest);
      console.log(`Export OK: ${out} (${manifest.phases.length} phases)`);
      return;
    }

    console.error("Usage: phaseManifestCli <import|export>");
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
