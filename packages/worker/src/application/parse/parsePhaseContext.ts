import type { GeoPipelinePhaseMode } from "../geo-pipeline/GeoPipelineContext.js";

/** Контекст фазы ingestParse (baseline / enrich). */
export type ParsePhaseContext = {
  phaseId?: string;
  phaseMode?: GeoPipelinePhaseMode;
};
