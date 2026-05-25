import { MONOREPO_ROOT } from "@repo/root";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { createWorkerDataSource } from "../infrastructure/persistence/createWorkerDataSource.js";
import { createWorkerDbRepositories } from "../infrastructure/persistence/workerDbRepos.js";
import {
  exportIngestManifest,
  importIngestManifest,
  loadIngestManifest,
  writeIngestManifest,
} from "../infrastructure/manifest/ingestManifestLoader.js";
import { parsePositionalArgs } from "./workerCliArgs.js";

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const command = parsePositionalArgs(process.argv)[0];
  const dataSource = await createWorkerDataSource();
  const db = await createWorkerDbRepositories(dataSource);
  const repos = {
    providers: db.ingestProviders,
    bindings: db.ingestBindings,
    channels: db.channels,
  };

  try {
    if (command === "import") {
      const manifest = loadIngestManifest(MONOREPO_ROOT);
      if (!manifest) {
        console.error("Ingest manifest не найден.");
        process.exit(1);
      }
      const stats = await importIngestManifest(manifest, repos);
      console.log("Import OK:", stats);
      return;
    }

    if (command === "export") {
      const manifest = await exportIngestManifest(repos);
      const path = writeIngestManifest(MONOREPO_ROOT, manifest);
      console.log(`Export OK: ${path} (${manifest.entries.length} entries)`);
      return;
    }

    console.error("Usage: ingestManifestCli <import|export>");
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
