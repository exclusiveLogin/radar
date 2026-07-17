/**
 * Один тик tracking runner.
 */
import { MONOREPO_ROOT } from "@repo/root";
import { createWorkerCompositionRoot } from "../application/createWorkerCompositionRoot.js";
import { cliWorkerRuntime } from "./cliWorkerRuntime.js";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";

async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const runtime = await createWorkerCompositionRoot(cliWorkerRuntime("tracking", ["tracking"]));
  const launcher = runtime.trackingLauncher;
  if (!launcher) { console.error("[tracking:tick] launcher missing"); process.exit(1); }
  try { launcher.enqueue?.(); await new Promise((r) => setTimeout(r, 500)); console.log("[tracking:tick] ok"); }
  catch (err) { console.error(err); process.exit(1); }
  finally { await runtime.shutdown?.(); }
}

void main();
