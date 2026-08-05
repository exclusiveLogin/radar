/**
 * LLM Validator processor: artifact.llmValidator.verdicts → candidate.extras по id.
 * Не создаёт кандидатов; только аннотирует уже существующих (ADR-027).
 */
import type { GeoEnrichmentArtifact, ParseWorkspace } from "@radar/shared";
import { listActiveCandidates, writeNamespaceSlice } from "./parseProcessorContract.js";

const AUTHOR = "llm-validator-processor";

/**
 * Прокидывает вердикты валидатора на matching candidates строго по candidateId.
 */
export function runLlmValidatorProcessor(workspace: ParseWorkspace): void {
  const artifact = workspace.namespaces.geoArtifact as GeoEnrichmentArtifact | undefined;
  const llmValidator = artifact?.llmValidator;

  writeNamespaceSlice(workspace, "llmValidator", {
    invoked: Boolean(llmValidator),
    verdictCount: llmValidator?.verdicts?.length ?? 0,
    skippedReason: llmValidator?.skippedReason,
  });

  const verdicts = llmValidator?.verdicts;
  if (!verdicts?.length) return;

  const byId = new Map(verdicts.map((v) => [v.candidateId, v]));

  for (const candidate of listActiveCandidates(workspace)) {
    const verdict = byId.get(candidate.id);
    if (!verdict) continue;
    candidate.extras = {
      ...candidate.extras,
      llmValidatorVerdict: verdict.verdict,
      llmValidatorConfidence: verdict.confidence,
      ...(verdict.reason ? { llmValidatorReason: verdict.reason } : {}),
      llmValidatorAuthor: AUTHOR,
    };
  }
}
