import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ParseWorkspace } from "@radar/shared";
import type { IPlaceScanPort } from "@radar/shared";
import { runGeoProcessor } from "./geoProcessor.js";
import { runEventTypeProcessor } from "./eventTypeProcessor.js";
import { runMassClearExcludeProcessor } from "./massClearExcludeProcessor.js";
import { runMassClearScopeProcessor } from "./massClearScopeProcessor.js";
import { runRepeatProcessor, runMassProcessor, runCountProcessor } from "./traitProcessors.js";
import { runLlmProcessor } from "./llmProcessor.js";
import { runDadataProcessor } from "./dadataProcessor.js";
import { runNominatimProcessor } from "./nominatimProcessor.js";
import { runVicinityProcessor } from "./vicinityProcessor.js";

export type ParseProcessorId =
  | "geo-processor"
  | "event-type-processor"
  | "mass-clear-exclude-processor"
  | "mass-clear-scope-processor"
  | "vicinity-processor"
  | "repeat-processor"
  | "mass-processor"
  | "count-processor"
  | "llm-processor"
  | "dadata-processor"
  | "nominatim-processor";

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
  placeScan: IPlaceScanPort;
};

export type ParseProcessorFn = (ctx: ParseProcessorContext) => void;

const PROCESSOR_IMPL: Record<ParseProcessorId, ParseProcessorFn> = {
  "geo-processor": ({ workspace, placeScan }) => runGeoProcessor({ workspace, placeScan }),
  "event-type-processor": ({ workspace }) => {
    runEventTypeProcessor(workspace);
  },
  "mass-clear-exclude-processor": ({ workspace, placeScan }) =>
    runMassClearExcludeProcessor({ workspace, placeScan }),
  "mass-clear-scope-processor": ({ workspace }) => {
    runMassClearScopeProcessor(workspace);
  },
  "vicinity-processor": ({ workspace }) => runVicinityProcessor(workspace),
  "repeat-processor": ({ workspace }) => runRepeatProcessor(workspace),
  "mass-processor": ({ workspace }) => runMassProcessor(workspace),
  "count-processor": ({ workspace }) => runCountProcessor(workspace),
  "llm-processor": ({ workspace }) => runLlmProcessor(workspace),
  "dadata-processor": ({ workspace }) => runDadataProcessor(workspace),
  "nominatim-processor": ({ workspace }) => runNominatimProcessor(workspace),
};

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
      { id: "mass-clear-exclude-processor", enabled: true, order: 25 },
      { id: "mass-clear-scope-processor", enabled: true, order: 30 },
      { id: "vicinity-processor", enabled: true, order: 35 },
      { id: "repeat-processor", enabled: true, order: 40 },
      { id: "mass-processor", enabled: true, order: 50 },
      { id: "count-processor", enabled: true, order: 60 },
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

/** Запуск одного processor по id (enricher sub-step). */
export function runProcessorById(
  id: ParseProcessorId,
  ctx: ParseProcessorContext,
): boolean {
  const impl = PROCESSOR_IMPL[id];
  if (!impl) return false;
  const t0 = performance.now();
  try {
    impl(ctx);
    ctx.workspace.processorLog.push({
      id,
      ok: true,
      durationMs: Math.round(performance.now() - t0),
    });
    return true;
  } catch {
    ctx.workspace.processorLog.push({
      id,
      ok: false,
      durationMs: Math.round(performance.now() - t0),
    });
    return false;
  }
}

/** @deprecated Используйте runCatalogEnricher / runParseEnricher */
export function runProcessorPipeline(ctx: ParseProcessorContext): void {
  const registry = loadProcessorRegistry();
  for (const entry of registry.processors) {
    if (!entry.enabled) continue;
    if (!isKnownProcessorId(entry.id)) continue;
    runProcessorById(entry.id, ctx);
  }
}
