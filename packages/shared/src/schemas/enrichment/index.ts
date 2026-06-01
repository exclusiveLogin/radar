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
  phaseKindSchema,
  enrichStageSchema,
  phaseManifestEntrySchema,
  phaseManifestSchema,
  phaseDefinitionSchema,
} from "./phase";

// --- type-only exports ---
export type {
  EnrichmentSource,
  MergePrecision,
  ProvenanceMeta,
  FieldProvenance,
} from "./provenance";
export type {
  EnricherId,
  PhaseKind,
  EnrichStage,
  PhaseManifestEntry,
  PhaseManifest,
  PhaseDefinition,
} from "./phase";
