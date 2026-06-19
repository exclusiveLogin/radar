import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { EnricherId } from "@radar/shared";

export type ParseEnricherId = EnricherId;

export type ParseEnricherEntry = {
  id: ParseEnricherId;
  trust: number;
  processorPriority: number;
  processors: string[];
};

export type ParseEnricherRegistry = {
  revision: string;
  enrichers: ParseEnricherEntry[];
  processorTieBreak: Record<string, number>;
};

function parseEnrichersYaml(raw: string): ParseEnricherRegistry {
  const revisionMatch = raw.match(/^revision:\s*"?([^"\n]+)"?/m);
  const revision = revisionMatch?.[1]?.trim() ?? "unknown";
  const enrichers: ParseEnricherEntry[] = [];
  const processorTieBreak: Record<string, number> = {};

  let section: "none" | "enrichers" | "tieBreak" = "none";
  let current: Partial<ParseEnricherEntry> & { processors?: string[] } | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "enrichers:") {
      section = "enrichers";
      continue;
    }
    if (trimmed === "processorTieBreak:") {
      if (current?.id) enrichers.push(current as ParseEnricherEntry);
      current = null;
      section = "tieBreak";
      continue;
    }
    if (section === "tieBreak" && trimmed.includes(":")) {
      const [key, val] = trimmed.split(":").map((s) => s.trim());
      if (key && val) processorTieBreak[key] = Number(val);
      continue;
    }
    if (section !== "enrichers") continue;

    if (trimmed.startsWith("- id:")) {
      if (current?.id) enrichers.push(current as ParseEnricherEntry);
      current = { id: trimmed.split(":")[1]!.trim() as ParseEnricherId, processors: [] };
      continue;
    }
    if (!current) continue;
    if (trimmed.startsWith("trust:")) {
      current.trust = Number(trimmed.split(":")[1]!.trim());
    }
    if (trimmed.startsWith("processorPriority:")) {
      current.processorPriority = Number(trimmed.split(":")[1]!.trim());
    }
    if (trimmed.startsWith("- ") && trimmed.includes("-processor")) {
      current.processors!.push(trimmed.slice(2).trim());
    }
  }
  if (current?.id) enrichers.push(current as ParseEnricherEntry);

  return { revision, enrichers, processorTieBreak };
}

function defaultRegistry(): ParseEnricherRegistry {
  return {
    revision: "builtin",
    enrichers: [
      {
        id: "catalog",
        trust: 80,
        processorPriority: 50,
        processors: [
          "geo-processor",
          "event-type-processor",
          "mass-clear-exclude-processor",
          "mass-clear-scope-processor",
          "repeat-processor",
          "mass-processor",
          "count-processor",
        ],
      },
      { id: "llm", trust: 90, processorPriority: 60, processors: ["llm-processor"] },
      { id: "dadata", trust: 75, processorPriority: 40, processors: ["dadata-processor"] },
      { id: "nominatim", trust: 70, processorPriority: 30, processors: ["nominatim-processor"] },
    ],
    processorTieBreak: {
      "llm-processor": 100,
      "event-type-processor": 90,
      "mass-clear-scope-processor": 85,
      "geo-processor": 80,
      "dadata-processor": 70,
      "nominatim-processor": 65,
    },
  };
}

let cached: ParseEnricherRegistry | null = null;

export function loadParseEnricherRegistry(): ParseEnricherRegistry {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../../../data/parse/parse-enrichers.v1.yaml");
  try {
    cached = parseEnrichersYaml(readFileSync(path, "utf8"));
  } catch {
    cached = defaultRegistry();
  }
  return cached;
}

export function enricherRegistryRevisionHash(registry: ParseEnricherRegistry): string {
  return createHash("sha256").update(JSON.stringify(registry), "utf8").digest("hex").slice(0, 12);
}

export function getEnricherTrust(enricherId: ParseEnricherId): number {
  const entry = loadParseEnricherRegistry().enrichers.find((e) => e.id === enricherId);
  return entry?.trust ?? 50;
}

export function getProcessorTieBreak(processorId: string): number {
  return loadParseEnricherRegistry().processorTieBreak[processorId] ?? 0;
}

export function listEnricherProcessorIds(enricherId: ParseEnricherId): string[] {
  const entry = loadParseEnricherRegistry().enrichers.find((e) => e.id === enricherId);
  return entry?.processors ?? [];
}
