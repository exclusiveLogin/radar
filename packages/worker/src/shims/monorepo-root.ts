import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** `src/shims` → `src` → `packages/worker` → `packages` → корень монорепы */
export const MONOREPO_ROOT = path.resolve(here, "../../../..");
