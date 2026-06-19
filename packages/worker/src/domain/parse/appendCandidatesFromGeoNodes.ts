import type { EnricherId, GeoNode, ParseWorkspace } from "@radar/shared";
import { appendCandidate } from "./parseProcessorContract.js";

/** Append geo nodes из artifact slice (llm/dadata/nominatim) как candidates. */
export function appendCandidatesFromGeoNodes(input: {
  workspace: ParseWorkspace;
  nodes: GeoNode[];
  authorProcessorId: string;
  authorEnricherId: EnricherId;
  defaultEventType?: string;
}): void {
  const text = input.workspace.groomedText;
  for (const node of input.nodes) {
    if (!node.name?.trim()) continue;
    const span = {
      start: 0,
      end: text.length,
      matchedText: node.name,
    };
    appendCandidate({
      workspace: input.workspace,
      authorProcessorId: input.authorProcessorId,
      authorEnricherId: input.authorEnricherId,
      anchor: {
        kind: node.kind === "region" ? "region" : "place",
        name: node.name,
        regionCode: node.regionCode,
        placeFias: node.fiasId,
        lat: node.lat,
        lon: node.lon,
        span,
      },
      eventType: input.defaultEventType ?? "unknown",
      provenance: {
        eventTypeSource: "pending",
        anchorSource: input.authorProcessorId,
      },
    });
  }
}
