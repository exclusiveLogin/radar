import type { PipelineStepId } from "../infrastructure/enrichers/enricherChainFactory.js";
import {
  resolveWorkerStorageMode,
} from "../infrastructure/persistence/storageMode.js";
import type { WorkerStorageMode } from "../infrastructure/persistence/storageMode.js";

export type CliFlagMap = Map<string, string | true>;

const pipelineStepIds = new Set<PipelineStepId>([
  "catalog",
  "llm",
  "dadata",
  "nominatim",
]);

/** Parses long CLI flags (`--key=value` and `--key value`) into a map. */
export function parseLongFlagsMap(argv: string[]): CliFlagMap {
  const map: CliFlagMap = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    if (token.includes("=")) {
      const [key, value] = token.slice(2).split("=", 2);
      map.set(key, value);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      map.set(key, next);
      index += 1;
    } else {
      map.set(key, true);
    }
  }

  return map;
}

/** Returns positional CLI args while skipping long flags and their values. */
export function parsePositionalArgs(argv: string[]): string[] {
  const args: string[] = [];
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      if (!token.includes("=")) {
        const next = argv[index + 1];
        if (next && !next.startsWith("--")) {
          index += 1;
        }
      }
      continue;
    }
    args.push(token);
  }
  return args;
}

/** Reads the first string-valued flag from a list of aliases. */
export function readStringFlag(
  map: CliFlagMap,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = map.get(key);
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

/** Checks whether any flag alias is present in the parsed map. */
export function hasAnyFlag(map: CliFlagMap, keys: readonly string[]): boolean {
  return keys.some((key) => map.has(key));
}

/** Parses and validates pipeline step order from comma-separated input. */
export function parsePipelineOrder(
  value: string | undefined,
): PipelineStepId[] | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = value
    .split(",")
    .map((part) => part.trim().toLowerCase() as PipelineStepId)
    .filter((part) => pipelineStepIds.has(part));

  return parsed.length > 0 ? parsed : undefined;
}

/** Resolves worker storage mode from known flag aliases with fallback. */
export function parseStorageModeFromMap(
  map: CliFlagMap,
  fallback: WorkerStorageMode,
): WorkerStorageMode {
  return resolveWorkerStorageMode(
    readStringFlag(map, ["storage-mode", "storage"]),
    fallback,
  );
}
