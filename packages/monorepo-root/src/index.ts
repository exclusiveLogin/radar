import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** `dist` → `monorepo-root` → `packages` → корень монорепы */
export const MONOREPO_ROOT = path.resolve(here, "../../..");

/** Путь к `data/` в корне репозитория. */
export function repoDataPath(...segments: string[]): string {
  return path.join(MONOREPO_ROOT, "data", ...segments);
}
