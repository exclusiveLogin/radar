import type { GeoEnrichmentArtifact } from "@radar/shared";
import type { ParseWorkspace } from "@radar/shared";
import type { EventType } from "@radar/shared";
import { appendCandidatesFromGeoNodes } from "./appendCandidatesFromGeoNodes.js";
import { writeNamespaceSlice } from "./parseProcessorContract.js";
import { createTraitAttachment } from "./attachRule.js";
import { EVENT_TYPE_TRAIT_KEY } from "./resolveEventTypeForCandidate.js";

const AUTHOR = "llm-processor";
const ENRICHER = "llm";

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
