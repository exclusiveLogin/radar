import type { GeoEnrichmentArtifact } from "@radar/shared";
import type { ParseWorkspace } from "@radar/shared";
import type { EventType } from "@radar/shared";
import { appendCandidatesFromGeoNodes } from "./appendCandidatesFromGeoNodes.js";
import { listActiveCandidates, writeNamespaceSlice } from "./parseProcessorContract.js";
import { createTraitAttachment } from "./attachRule.js";
import { EVENT_TYPE_TRAIT_KEY } from "./resolveEventTypeForCandidate.js";

const AUTHOR = "llm-processor";
const ENRICHER = "llm";

/**
 * Прокидывает places[].confidence/reason на matching active candidates (ADR-027).
 * Сопоставление: имя (case-insensitive) или regionCode для region-якоря.
 */
function annotateLlmConfidenceOnCandidates(workspace: ParseWorkspace): void {
  const artifact = workspace.namespaces.geoArtifact as GeoEnrichmentArtifact | undefined;
  const nodes = artifact?.llm?.nodes;
  if (!nodes?.length) return;

  for (const candidate of listActiveCandidates(workspace)) {
    const name = candidate.anchor.name?.trim().toLowerCase();
    const regionCode = candidate.anchor.regionCode;
    const node = nodes.find((n) => {
      const nodeName = n.name?.trim().toLowerCase();
      if (name && nodeName && name === nodeName) return true;
      if (
        candidate.anchor.kind === "region"
        && regionCode
        && n.regionCode
        && regionCode === n.regionCode
        && n.kind === "region"
      ) {
        return true;
      }
      return false;
    });
    if (!node) continue;
    if (typeof node.confidence === "number") {
      candidate.extras.llmConfidence = node.confidence;
    }
    if (typeof node.reason === "string" && node.reason.trim()) {
      candidate.extras.llmReason = node.reason;
    }
  }
}

/**
 * LLM enricher: namespaces.llm + eventType traits + gap-fill candidates (без дублей geo mergeKey).
 * Geo-кандидаты не отклоняются на other/noise — деактивация через resolveParsedEventActivation.
 */
export function runLlmProcessor(workspace: ParseWorkspace): void {
  const artifact = workspace.namespaces.geoArtifact as GeoEnrichmentArtifact | undefined;
  const llm = artifact?.llm;
  writeNamespaceSlice(workspace, "llm", {
    invoked: Boolean(llm),
    eventCategory: llm?.eventCategory,
    eventSubject: llm?.eventSubject,
  });

  const mappedEventType = mapLlmCategoryToEventType(llm?.eventCategory);
  if (mappedEventType) {
    workspace.traitAttachments.push(
      createTraitAttachment({
        processorId: AUTHOR,
        traitKey: EVENT_TYPE_TRAIT_KEY,
        value: mappedEventType,
        attachRule: { scope: "all_candidates" },
      }),
    );
  }

  if (!llm?.nodes?.length) return;

  appendCandidatesFromGeoNodes({
    workspace,
    nodes: llm.nodes,
    authorProcessorId: AUTHOR,
    authorEnricherId: ENRICHER,
    onlyMissingMergeKeys: true,
  });
  annotateLlmConfidenceOnCandidates(workspace);
}

function mapLlmCategoryToEventType(category: string | undefined): EventType | null {
  if (!category) return null;
  const map: Record<string, EventType | null> = {
    all_clear: "cleared",
    cleared: "cleared",
    threat: "danger",
    danger: "danger",
    impact: "impact",
    intercept: "intercept",
    fixation: "fixation",
    movement: "fixation",
    pvo_work: "pvo_work",
    warning: "warning",
    mass_warning: "warning",
    attention: "attention",
    rocket_threat: "rocket_threat",
    noise: null,
    other: null,
  };
  return map[category] ?? "attention";
}
