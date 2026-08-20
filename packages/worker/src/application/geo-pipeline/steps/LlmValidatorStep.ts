/**
 * Application step: отбор кандидатов → LLM Validator → artifact.llmValidator.
 * Работает с ParseWorkspace (не GeoPipelineStep): нужен candidate.id и geoScore.
 */
import type { EventCandidate, GeoEnrichmentArtifact, ParseWorkspace } from "@radar/shared";
import { listActiveCandidates } from "../../../domain/parse/parseProcessorContract.js";
import { runGeoCandidateScoring } from "../../../domain/parse/geo/geoCandidateScoring.js";
import type { GeoScoreMatrix } from "../../../domain/parse/geo/geoCandidateScore.js";
import { loadGeoScoreMatrix } from "../../../domain/parse/geo/geoScoreMatrixRegistry.js";
import { selectLlmValidatorCandidates } from "../../../domain/parse/geo/llmValidatorTrigger.js";
import type {
  LlmValidatorCandidateInput,
  LlmValidatorEnricher,
} from "../../../infrastructure/enrichers/llmValidatorEnricher.js";
import { isLlmOpHardFailure } from "../../../domain/parse/geo/llmOpResult.js";

function ensureGeoArtifact(workspace: ParseWorkspace): GeoEnrichmentArtifact {
  const existing = workspace.namespaces.geoArtifact as GeoEnrichmentArtifact | undefined;
  if (existing) return existing;
  const artifact: GeoEnrichmentArtifact = {};
  workspace.namespaces.geoArtifact = artifact;
  return artifact;
}

function readBoolFlag(extras: Record<string, unknown>, key: string): boolean | undefined {
  return extras[key] === true ? true : undefined;
}

function toValidatorInput(candidate: EventCandidate): LlmValidatorCandidateInput {
  const extras = candidate.extras ?? {};
  const breakdown = (extras.geoScoreBreakdown ?? {}) as Record<string, number>;
  return {
    id: candidate.id,
    name: candidate.anchor.name ?? candidate.anchor.regionCode ?? candidate.id,
    kind: candidate.anchor.kind,
    regionCode: candidate.anchor.regionCode,
    geoScore: typeof extras.geoScore === "number" ? extras.geoScore : undefined,
    flags: {
      matchedViaAdjectiveStem: readBoolFlag(extras, "matchedViaAdjectiveStem"),
      geoImprecise: readBoolFlag(extras, "geoImprecise"),
      minorityRegion: typeof breakdown.minorityRegion === "number" ? true : undefined,
      geoConflict: typeof breakdown.geoConflict === "number" ? true : undefined,
      uniqueStem: typeof breakdown.uniqueStem === "number" ? true : undefined,
    },
  };
}

export class LlmValidatorStep {
  readonly id = "llm-validator";

  constructor(private readonly enricher: LlmValidatorEnricher) {}

  async run(
    workspace: ParseWorkspace,
    matrix: GeoScoreMatrix = loadGeoScoreMatrix(),
  ): Promise<void> {
    const artifact = ensureGeoArtifact(workspace);

    // Pre-score: auto-trigger опирается на extras.geoScore прошлой фазы / текущего WS.
    runGeoCandidateScoring(workspace, matrix);

    const selected = selectLlmValidatorCandidates(listActiveCandidates(workspace), matrix);
    if (selected.length === 0) {
      artifact.llmValidator = {
        schemaVersion: 1,
        verdicts: [],
        skippedReason:
          matrix.llmValidator.trigger === "off"
            ? "trigger_off"
            : "no_candidates",
      };
      return;
    }

    const result = await this.enricher.validate({
      rawText: workspace.groomedText,
      candidates: selected.map(toValidatorInput),
    });

    if (!result.ok) {
      artifact.llmValidator = {
        schemaVersion: 1,
        verdicts: [],
        skippedReason: result.reason,
      };
      if (isLlmOpHardFailure(result.reason)) {
        throw new Error(`llm-validator:${result.reason}`);
      }
      return;
    }

    artifact.llmValidator = {
      schemaVersion: 1,
      verdicts: result.data.verdicts,
    };
  }
}
