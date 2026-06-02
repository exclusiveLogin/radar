// --- runtime exports ---
export {
  enrichmentSourceSchema,
  mergePrecisionSchema,
  provenanceMetaSchema,
  fieldProvenance,
  SOURCE_TRUST,
  PRECISION_RANK,
} from "./provenance";
export {
  enricherIdSchema,
  phaseTriggerSchema,
  phaseScopeSchema,
  phaseKindSchema,
  enrichStageSchema,
  phasePolicySchema,
  DEFAULT_PHASE_POLICY,
  phaseManifestEntrySchema,
  phaseManifestSchema,
  phaseDefinitionSchema,
  manualRunScopeSchema,
  LEGACY_PHASE_ID_MAP,
  normalizePhaseManifestEntry,
} from "./phase";
export {
  phaseRunStatusSchema,
  phaseRunControlSchema,
  phaseRunLogEntrySchema,
  phaseRunStatsSchema,
  phaseRunSchema,
  phaseReplayRequestSchema,
} from "./phase-run";
export { phaseRunsOverviewSchema } from "./phase-admin";

// --- type-only exports ---
export type {
  EnrichmentSource,
  MergePrecision,
  ProvenanceMeta,
  FieldProvenance,
} from "./provenance";
export type {
  EnricherId,
  PhaseTrigger,
  PhaseScope,
  PhaseKind,
  EnrichStage,
  PhasePolicy,
  PhaseManifestEntry,
  PhaseManifest,
  PhaseDefinition,
  ManualRunScope,
} from "./phase";
export type {
  PhaseRunStatus,
  PhaseRunControl,
  PhaseRunLogEntry,
  PhaseRunStats,
  PhaseRun,
  PhaseReplayRequest,
} from "./phase-run";
export type { PhaseRunsOverview } from "./phase-admin";
