import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDist = path.resolve(here, "../../../../api/dist");

/**
 * Абсолютный путь к скомпилированному модулю API (`dist/...`).
 * Worker не импортирует `api/src` через tsx — ломаются декораторы TypeORM.
 */
export function resolveApiDistFile(...segments: string[]): string {
  const file = path.join(apiDist, ...segments);
  if (!fs.existsSync(file)) {
    throw new Error(
      [
        `Модуль API не найден: ${file}`,
        "Соберите API: npm run build -w @radar/api (или дождитесь nest watch в dev).",
      ].join(" "),
    );
  }
  return file;
}

/** ESM dynamic import URL для Windows. */
export function importApiDistModule(...segments: string[]): Promise<unknown> {
  return import(pathToFileURL(resolveApiDistFile(...segments)).href);
}

/** Корень `packages/api/dist` (для glob entity). */
export function getApiDistRoot(): string {
  if (!fs.existsSync(apiDist)) {
    throw new Error(
      `Каталог API dist не найден: ${apiDist}. Запустите nest build / api:dev до worker.`,
    );
  }
  return apiDist;
}
