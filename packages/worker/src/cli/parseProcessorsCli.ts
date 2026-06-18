import {
  loadProcessorRegistry,
  registryRevisionHash,
  PARSE_PROCESSOR_IDS,
  type ParseProcessorId,
} from "../domain/parse/processorRegistry.js";
import { hasAnyFlag, parseLongFlagsMap } from "./workerCliArgs.js";

function listProcessors(): void {
  const registry = loadProcessorRegistry();
  console.log(
    JSON.stringify(
      {
        revision: registry.revision,
        revisionHash: registryRevisionHash(registry),
        processors: registry.processors,
      },
      null,
      2,
    ),
  );
}

function validateProcessors(): void {
  const registry = loadProcessorRegistry();
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const entry of registry.processors) {
    if (ids.has(entry.id)) errors.push(`duplicate id: ${entry.id}`);
    ids.add(entry.id);
    if (!PARSE_PROCESSOR_IDS.includes(entry.id as ParseProcessorId)) {
      errors.push(`unknown processor id: ${entry.id}`);
    }
  }
  if (errors.length > 0) {
    console.error(JSON.stringify({ ok: false, errors }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        revision: registry.revision,
        revisionHash: registryRevisionHash(registry),
        count: registry.processors.length,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const flags = parseLongFlagsMap(process.argv);
  const cmd = process.argv[2] ?? "list";

  if (hasAnyFlag(flags, ["help", "h"])) {
    console.log(`Usage:
  npm run parse-engine:processors:list
  npm run parse-engine:processors:validate`);
    process.exit(0);
  }

  if (cmd === "validate") {
    validateProcessors();
    return;
  }
  listProcessors();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
