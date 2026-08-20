import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { hasAnyFlag, parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

/** Finalize одного raw по uuid. */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const flags = parseLongFlagsMap(process.argv);
  const rawId = readStringFlag(flags, ["raw-id", "rawId"]);

  if (hasAnyFlag(flags, ["help", "h"]) || !rawId) {
    console.log("Usage: npm run parse-engine:workspace:finalize -- --raw-id=<uuid>");
    process.exit(rawId ? 0 : 1);
  }

  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("parse", ["parse"]));
  if (!runtime.dataSource || !runtime.workspaceService || !runtime.workerRepos) {
    console.error("workspace:finalize: нужен RADAR_STORAGE_MODE=db");
    process.exit(1);
  }

  const raw = await runtime.workerRepos.rawMessages.findById(rawId);
  if (!raw?.id) {
    console.error(`raw ${rawId} не найден`);
    process.exit(1);
  }

  const result = await runtime.workspaceService.run({
    rawMessageId: raw.id,
    rawText: raw.rawText,
    postedAt: raw.postedAt,
    runKind: "phase_enrich",
    geoContext: { enrichers: [] },
    mode: "refinalize",
  });

  if (result.kind !== "event") {
    console.log(JSON.stringify({ ok: false, reason: result.reason }, null, 2));
    process.exit(0);
  }

  console.log(JSON.stringify({ ok: true, finalize: result.finalize }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
