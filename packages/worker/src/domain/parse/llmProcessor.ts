import type { GeoEnrichmentArtifact } from "@radar/shared";
import type { ParseWorkspace } from "@radar/shared";
import { appendCandidate, rejectOwnCandidates, writeNamespaceSlice } from "./parseProcessorContract.js";

const AUTHOR = "llm-processor";
const ENRICHER = "llm";

/**
 * LLM enricher processor: пишет namespaces.llm + append/reject candidates.
 * Вход — geoArtifact в namespaces (из prior enrich run) или пусто.
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

  for (const node of llm.nodes) {
    if (!node.name?.trim()) continue;
    const span = {
      start: 0,
      end: workspace.groomedText.length,
      matchedText: node.name,
    };
    appendCandidate({
      workspace,
      authorProcessorId: AUTHOR,
      authorEnricherId: ENRICHER,
      anchor: {
        kind: node.kind === "region" ? "region" : "place",
        name: node.name,
        regionCode: node.regionCode,
        lat: node.lat,
        lon: node.lon,
        span,
      },
      eventType: mapLlmCategoryToEventType(llm.eventCategory),
      provenance: {
        eventTypeSource: AUTHOR,
        anchorSource: "llm-processor",
      },
    });
  }

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
