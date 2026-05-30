import * as path from "node:path";

/**
 * Корень монорепозитория (независимо от process.cwd).
 * `packages/api/dist` или `packages/api/src` → три уровня вверх.
 */
export const MONOREPO_ROOT = path.resolve(__dirname, "../../..");

/** Путь к каталогу `data/` в корне репозитория. */
export function repoDataPath(...segments: string[]): string {
  return path.join(MONOREPO_ROOT, "data", ...segments);
}
