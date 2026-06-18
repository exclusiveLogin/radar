import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ParseWorkspace } from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { runGeoProcessor } from "./geoProcessor.js";
import { runEventTypeProcessor } from "./eventTypeProcessor.js";
import { runRepeatProcessor, runMassProcessor, runCountProcessor } from "./traitProcessors.js";

export type ParseProcessorId =
  | "geo-processor"
  | "event-type-processor"
  | "repeat-processor"
  | "mass-processor"
  | "count-processor";

export type ProcessorRegistryEntry = {
  id: ParseProcessorId;
  enabled: boolean;
  order: number;
};

export type ProcessorRegistry = {
  revision: string;
  processors: ProcessorRegistryEntry[];
};

export type ParseProcessorContext = {
  workspace: ParseWorkspace;
  geoCatalog: GeoCatalog;
};

export type ParseProcessorFn = (ctx: ParseProcessorContext) => void;

const PROCESSOR_IMPL = {
  "geo-processor": ({ workspace, geoCatalog }) => runGeoProcessor({ workspace, geoCatalog }),
  "event-type-processor": ({ workspace }) => {
    runEventTypeProcessor(workspace);
  },
  "repeat-processor": ({ workspace }) => runRepeatProcessor(workspace),
  "mass-processor": ({ workspace }) => runMassProcessor(workspace),
  "count-processor": ({ workspace }) => runCountProcessor(workspace),
} as const satisfies Record<string, ParseProcessorFn>;

export const PARSE_PROCESSOR_IDS = Object.keys(PROCESSOR_IMPL) as ParseProcessorId[];

function isKnownProcessorId(id: string): id is ParseProcessorId {
  return id in PROCESSOR_IMPL;
}

function defaultRegistry(): ProcessorRegistry {
  return {
    revision: "builtin",
    processors: [
      { id: "geo-processor", enabled: true, order: 10 },
      { id: "event-type-processor", enabled: true, order: 20 },
      { id: "repeat-processor", enabled: true, order: 30 },
      { id: "mass-processor", enabled: true, order: 40 },
      { id: "count-processor", enabled: true, order: 50 },
    ],
  };
}

function parseRegistryYaml(raw: string): ProcessorRegistry {
  const revisionMatch = raw.match(/^revision:\s*"?([^"\n]+)"?/m);
  const revision = revisionMatch?.[1]?.trim() ?? "unknown";
  const processors: ProcessorRegistryEntry[] = [];
  const lines = raw.split("\n");
  let current: Partial<ProcessorRegistryEntry> | null = null;
  for (const line of lines) {
    if (line.trim() === "processors:") continue;
    if (line.startsWith("  - id:")) {
      if (current?.id) processors.push(current as ProcessorRegistryEntry);
      current = { id: line.split(":")[1]!.trim() as ParseProcessorId, enabled: true, order: 0 };
      continue;
    }
    if (!current) continue;
    if (line.includes("enabled:")) {
      current.enabled = line.includes("true");
    }
    if (line.includes("order:")) {
      current.order = Number(line.split(":")[1]!.trim());
    }
  }
  if (current?.id) processors.push(current as ProcessorRegistryEntry);
  return { revision, processors: processors.sort((a, b) => a.order - b.order) };
}

let cachedRegistry: ProcessorRegistry | null = null;

export function loadProcessorRegistry(): ProcessorRegistry {
  if (cachedRegistry) return cachedRegistry;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../../../data/parse/parse-processors.v1.yaml");
  try {
    cachedRegistry = parseRegistryYaml(readFileSync(path, "utf8"));
  } catch {
    cachedRegistry = defaultRegistry();
  }
  return cachedRegistry;
}

export function registryRevisionHash(registry: ProcessorRegistry): string {
  return createHash("sha256").update(JSON.stringify(registry), "utf8").digest("hex").slice(0, 12);
}

/** Запуск enabled processors по registry. */
export function runProcessorPipeline(ctx: ParseProcessorContext): void {
  const registry = loadProcessorRegistry();
  for (const entry of registry.processors) {
    if (!entry.enabled) continue;
    const impl = isKnownProcessorId(entry.id) ? PROCESSOR_IMPL[entry.id] : undefined;
    if (!impl) continue;
    const t0 = performance.now();
    try {
      impl(ctx);
      ctx.workspace.processorLog.push({
        id: entry.id,
        ok: true,
        durationMs: Math.round(performance.now() - t0),
      });
    } catch {
      ctx.workspace.processorLog.push({
        id: entry.id,
        ok: false,
        durationMs: Math.round(performance.now() - t0),
      });
    }
  }
}
