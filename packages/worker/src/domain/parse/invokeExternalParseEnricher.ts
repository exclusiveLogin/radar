import type { GeoEnrichmentArtifact, ParseWorkspace } from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { LlmStep } from "../../application/geo-pipeline/steps/LlmStep.js";
import { DadataStep } from "../../application/geo-pipeline/steps/DadataStep.js";
import { NominatimStep } from "../../application/geo-pipeline/steps/NominatimStep.js";
import type { GeoPipelineContext } from "../../application/geo-pipeline/GeoPipelineContext.js";
import { LlmEnricher } from "../../infrastructure/enrichers/llmEnricher.js";
import { loadLlmRuntimeConfig } from "../../infrastructure/enrichers/llmRuntimeConfig.js";
import { DadataEnricher } from "../../infrastructure/enrichers/dadataEnricher.js";
import { loadDadataToken } from "../../infrastructure/enrichers/dadataConfig.js";
import { NominatimEnricher } from "../../infrastructure/enrichers/nominatimEnricher.js";
import type { ParseEnricherId } from "./parseEnricherRegistry.js";
import { syncCatalogArtifactFromWorkspace } from "./syncCatalogArtifactFromWorkspace.js";

export type ExternalParseEnricherDeps = {
  geoCatalog: GeoCatalog;
  llm?: LlmEnricher;
  dadata?: DadataEnricher;
  nominatim?: NominatimEnricher;
};

function ensureGeoArtifact(workspace: ParseWorkspace): GeoEnrichmentArtifact {
  const existing = workspace.namespaces.geoArtifact as GeoEnrichmentArtifact | undefined;
  if (existing) return existing;
  const artifact: GeoEnrichmentArtifact = {};
  workspace.namespaces.geoArtifact = artifact;
  return artifact;
}

/**
 * Lazy enricher prelude: вызывает LlmEnricher/Dadata/Nominatim и пишет slice в geoArtifact
 * до запуска sync processors (llm-processor, dadata-processor, …).
 */
export async function invokeExternalParseEnricher(
  enricherId: ParseEnricherId,
  workspace: ParseWorkspace,
  deps: ExternalParseEnricherDeps,
): Promise<void> {
  if (enricherId === "catalog") return;

  const artifact = ensureGeoArtifact(workspace);
  syncCatalogArtifactFromWorkspace(artifact, workspace, deps.geoCatalog);

  const ctx: GeoPipelineContext = {
    rawText: workspace.groomedText,
    artifact,
    stepLog: [],
    phaseMode: "enrich",
  };

  if (enricherId === "llm") {
    const llm = deps.llm ?? new LlmEnricher(loadLlmRuntimeConfig());
    await new LlmStep(llm, deps.geoCatalog).run(ctx);
    return;
  }

  if (enricherId === "dadata") {
    const dadata = deps.dadata ?? new DadataEnricher(loadDadataToken());
    await new DadataStep(dadata).run(ctx);
    return;
  }

  if (enricherId === "nominatim") {
    const nominatim = deps.nominatim ?? new NominatimEnricher();
    await new NominatimStep(nominatim).run(ctx);
  }
}
