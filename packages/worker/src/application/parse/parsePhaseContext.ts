import type { EnricherId } from "@radar/shared";
import type { GeoPipelinePhaseMode } from "../geo-pipeline/GeoPipelineContext.js";
import type { ParseWorkspaceRunKind } from "./parseWorkspaceRunModes.js";

/** Контекст фазы ingestParse для handler (runKind + enrichers). */
export type ParsePhaseContext = {
  phaseId?: string;
  phaseMode?: GeoPipelinePhaseMode;
  /** Enricher-ы из phase_definitions.enrichers */
  enrichers?: EnricherId[];
  /** rebuild | phase_enrich — из resolvePhaseRunKind(phase) */
  runKind?: ParseWorkspaceRunKind;
};
