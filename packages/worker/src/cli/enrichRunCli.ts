/**
 * @deprecated Используйте worker:phase:run -- --phase=<id>
 */
import { MONOREPO_ROOT } from "@repo/root";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { runPhaseCli } from "./phaseRunCli.js";
import { parseLongFlagsMap, readStringFlag } from "./workerCliArgs.js";

const STAGE_TO_PHASE: Record<string, string> = {
  llm: "llm",
  dadata: "dadata",
  nominatim: "nominatim",
};

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const map = parseLongFlagsMap(process.argv);
  const stage = readStringFlag(map, ["stage"])?.trim().toLowerCase();
  if (stage && !readStringFlag(map, ["phase"])) {
    process.argv.push(`--phase=${STAGE_TO_PHASE[stage] ?? stage}`);
  }
  await runPhaseCli();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
