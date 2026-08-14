import { MONOREPO_ROOT } from "@repo/root";
import { loadRootEnv } from "../infrastructure/config/loadRootEnv.js";
import { applyLlmEnv, assertOllamaReady } from "./ollamaPreflight.js";
import { runParseSnap } from "./parseSnap.js";
import { parseLongFlagsMap } from "./workerCliArgs.js";

/**
 * `parse:snap:ollama` — тонкий прокси над `parse:snap`: тот же контракт
 * (позиционный путь к снапу + общие флаги), плюс preflight ollama и перенос
 * `--base-url`/`--model` в env. LLM-обогащение включается принудительно.
 *
 * Usage: npm run parse:snap:ollama -- <path-to-snap.txt> [--model qwen2.5:14b] [--base-url http://127.0.0.1:11434/v1] [--storage-mode=memory|db|fs]
 *
 * Config: DEFAULT → geo.enrichers.manifest → GEO__ → CLI `--model`/`--base-url`.
 * Enricher llm включается на время CLI; phase_definitions / админка не меняются.
 */
async function main(): Promise<void> {
  loadRootEnv(MONOREPO_ROOT);
  const llm = applyLlmEnv(parseLongFlagsMap(process.argv));
  await assertOllamaReady(llm);
  await runParseSnap(process.argv, { forceLlm: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
