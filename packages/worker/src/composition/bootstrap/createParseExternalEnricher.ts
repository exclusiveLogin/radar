/**
 * ---
 * layer: worker/composition
 * domain: parse
 * purpose: Связывает внешние geo-провайдеры с parse application port.
 * ---
 */
import type {
  GeoEnrichmentArtifact,
  IRegionAdjacencyRepository,
  ParseWorkspace,
} from "@radar/shared";
import { DadataStep } from "../../application/geo-pipeline/steps/DadataStep.js";
import type { GeoPipelineContext } from "../../application/geo-pipeline/GeoPipelineContext.js";
import type { ParseExternalEnricher } from "../../application/parse/parseExternalEnricher.js";
import { LlmStep } from "../../application/geo-pipeline/steps/LlmStep.js";
import { LlmValidatorStep } from "../../application/geo-pipeline/steps/LlmValidatorStep.js";
import { NominatimStep } from "../../application/geo-pipeline/steps/NominatimStep.js";
import { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import { DadataEnricher } from "../../infrastructure/enrichers/dadataEnricher.js";
import { loadDadataToken } from "../../infrastructure/enrichers/dadataConfig.js";
import { LlmEnricher } from "../../infrastructure/enrichers/llmEnricher.js";
import { LlmValidatorEnricher } from "../../infrastructure/enrichers/llmValidatorEnricher.js";
import {
  loadLlmRuntimeConfig,
  loadLlmValidatorRuntimeConfig,
} from "../../infrastructure/enrichers/llmRuntimeConfig.js";
import { NominatimEnricher } from "../../infrastructure/enrichers/nominatimEnricher.js";
import { getLlmMetricsRecorder } from "../../infrastructure/metrics/prometheusLlmMetricsRecorder.js";
import { syncCatalogArtifactFromWorkspace } from "../../domain/parse/syncCatalogArtifactFromWorkspace.js";

function ensureGeoArtifact(workspace: ParseWorkspace): GeoEnrichmentArtifact {
  const existing = workspace.namespaces.geoArtifact as GeoEnrichmentArtifact | undefined;
  if (existing) return existing;

  const artifact: GeoEnrichmentArtifact = {};
  workspace.namespaces.geoArtifact = artifact;
  return artifact;
}

/**
 * Создаёт lazy HTTP enrichers для parse workspace.
 * `regionAdjacency` расширяет список допустимых регионов в промпте LLM;
 * без БД (in-memory режим) подсказка соседей просто не добавляется.
 */
export function createParseExternalEnricher(
  regionAdjacency?: IRegionAdjacencyRepository,
): ParseExternalEnricher {
  let llm: LlmEnricher | undefined;
  let llmValidator: LlmValidatorEnricher | undefined;
  let dadata: DadataEnricher | undefined;
  let nominatim: NominatimEnricher | undefined;

  return {
    async enrich(enricherId, workspace): Promise<void> {
      if (enricherId === "catalog") return;

      // LLM Validator работает с workspace (candidate.id + geoScore), не с GeoPipelineContext.
      if (enricherId === "llm-validator") {
        llmValidator ??= new LlmValidatorEnricher(
          loadLlmValidatorRuntimeConfig(),
          undefined,
          getLlmMetricsRecorder(),
        );
        await new LlmValidatorStep(llmValidator).run(workspace);
        return;
      }

      const artifact = ensureGeoArtifact(workspace);
      syncCatalogArtifactFromWorkspace(artifact, workspace);
      const context: GeoPipelineContext = {
        rawText: workspace.groomedText,
        artifact,
        stepLog: [],
        phaseMode: "enrich",
      };

      if (enricherId === "llm") {
        llm ??= new LlmEnricher(loadLlmRuntimeConfig(), undefined, getLlmMetricsRecorder());
        await new LlmStep(llm, GeoCatalog.loadFromArtifacts(), regionAdjacency).run(context);
        return;
      }

      if (enricherId === "dadata") {
        dadata ??= new DadataEnricher(loadDadataToken());
        await new DadataStep(dadata).run(context);
        return;
      }

      if (enricherId === "nominatim") {
        nominatim ??= new NominatimEnricher();
        await new NominatimStep(nominatim).run(context);
      }
    },
  };
}
