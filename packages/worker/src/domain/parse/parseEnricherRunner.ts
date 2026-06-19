import type { ParseWorkspace } from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { runEnricherProcessors } from "./runEnricherProcessors.js";
import type { ParseEnricherId } from "./parseEnricherRegistry.js";
import {
  enricherRegistryRevisionHash,
  loadParseEnricherRegistry,
} from "./parseEnricherRegistry.js";
import { createHash } from "node:crypto";
import { loadProcessorRegistry, registryRevisionHash } from "./processorRegistry.js";

export type EnricherRunContext = {
  workspace: ParseWorkspace;
  geoCatalog: GeoCatalog;
};

/** Запуск одного enricher-контейнера (processors → NS + candidates). */
export function runParseEnricher(
  enricherId: ParseEnricherId,
  ctx: EnricherRunContext,
): void {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  let ok = true;
  const processorIds: string[] = [];

  try {
    processorIds.push(...runEnricherProcessors(enricherId, ctx));
  } catch {
    ok = false;
  }

  ctx.workspace.enricherRunLog.push({
    enricherId,
    startedAt,
    processorIds,
    ok,
    durationMs: Math.round(performance.now() - t0),
  });
}

/** Eager catalog enricher (default ingest parse). */
export function runCatalogEnricher(ctx: EnricherRunContext): void {
  runParseEnricher("catalog", ctx);
}

/** Revision hash для workspace row (enrichers + processors). */
export function parsePipelineRevisionHash(): string {
  const enricher = enricherRegistryRevisionHash(loadParseEnricherRegistry());
  const processor = registryRevisionHash(loadProcessorRegistry());
  return createHash("sha256")
    .update(`${enricher}:${processor}`, "utf8")
    .digest("hex")
    .slice(0, 12);
}
