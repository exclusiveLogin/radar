import * as fs from "node:fs";
import * as path from "node:path";
import { parseConfigSchema, type ParseConfig } from "@radar/shared";

function readOptionalJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, unknown>;
}

/**
 * Итоговый конфиг парсинга: JSON-файл + переопределения из env.
 */
export function loadParseRuntimeConfig(repoRoot: string): ParseConfig {
  const fromEnvPath = process.env.RADAR_PARSE_CONFIG?.trim();
  const defaultPath = path.join(repoRoot, ".radar", "parse.config.json");
  const configPath = fromEnvPath
    ? path.isAbsolute(fromEnvPath)
      ? fromEnvPath
      : path.join(repoRoot, fromEnvPath)
    : defaultPath;

  const fromFile = readOptionalJsonFile(configPath);

  const fromShell: Record<string, unknown> = {};
  const batch = process.env.RADAR_PARSE_BATCH_LIMIT?.trim();
  if (batch !== undefined && batch !== "") {
    fromShell.batchLimit = Number(batch);
  }
  const mark = process.env.RADAR_PARSE_MARK_AS_READ?.trim().toLowerCase();
  if (mark === "1" || mark === "true" || mark === "yes") {
    fromShell.markAsRead = true;
  }

  return parseConfigSchema.parse({
    ...fromFile,
    ...fromShell,
  });
}
