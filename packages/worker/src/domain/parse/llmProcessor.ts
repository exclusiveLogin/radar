import type { GeoEnrichmentArtifact } from "@radar/shared";
import type { ParseWorkspace } from "@radar/shared";
import { appendCandidatesFromGeoNodes } from "./appendCandidatesFromGeoNodes.js";
import { rejectOwnCandidates, writeNamespaceSlice } from "./parseProcessorContract.js";
import { createTraitAttachment } from "./attachRule.js";
import { EVENT_TYPE_TRAIT_KEY } from "./resolveEventTypeForCandidate.js";

const AUTHOR = "llm-processor";
const ENRICHER = "llm";

/**
 * LLM enricher: namespaces.llm + eventType traits + gap-fill candidates (без дублей geo mergeKey).
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

  if (llm.eventCategory === "other") {
    rejectOwnCandidates({
      workspace,
      authorProcessorId: "geo-processor",
      predicate: () => true,
    });
  }
}

function mapLlmCategoryToEventType(category: string | undefined): string | null {
  if (category === "all_clear") return "cleared";
  if (category === "threat") return "danger";
  if (category === "impact") return "impact";
  if (category === "other") return null;
  return "attention";
}
