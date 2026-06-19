import type { GeoEnrichmentArtifact } from "@radar/shared";
import type { ParseWorkspace } from "@radar/shared";
import { appendCandidatesFromGeoNodes } from "./appendCandidatesFromGeoNodes.js";
import { rejectOwnCandidates, writeNamespaceSlice } from "./parseProcessorContract.js";

const AUTHOR = "llm-processor";
const ENRICHER = "llm";

/**
 * LLM enricher processor: namespaces.llm + append/reject candidates из geoArtifact.llm.
 * Вызов LlmEnricher — в invokeExternalParseEnricher (lazy phase prelude).
 */
export function runLlmProcessor(workspace: ParseWorkspace): void {
  const artifact = workspace.namespaces.geoArtifact as GeoEnrichmentArtifact | undefined;
  const llm = artifact?.llm;
  writeNamespaceSlice(workspace, "llm", {
    invoked: Boolean(llm),
    eventCategory: llm?.eventCategory,
    eventSubject: llm?.eventSubject,
  });

  if (!llm?.nodes?.length) return;

  appendCandidatesFromGeoNodes({
    workspace,
    nodes: llm.nodes,
    authorProcessorId: AUTHOR,
    authorEnricherId: ENRICHER,
    defaultEventType: mapLlmCategoryToEventType(llm.eventCategory),
  });

  if (llm.eventCategory === "other") {
    rejectOwnCandidates({
      workspace,
      authorProcessorId: "geo-processor",
      predicate: () => true,
    });
  }
}

function mapLlmCategoryToEventType(category: string | undefined): string {
  if (category === "all_clear") return "cleared";
  if (category === "threat") return "danger";
  if (category === "impact") return "impact";
  return "attention";
}
