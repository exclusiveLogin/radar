import type { EnricherId, GeoNode, ParseWorkspace } from "@radar/shared";
import { buildCandidateMergeKey } from "@radar/shared";
import { appendCandidate, listActiveCandidates } from "./parseProcessorContract.js";

function findSpan(text: string, needle: string): { start: number; end: number; matchedText: string } {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx < 0) {
    return { start: 0, end: text.length, matchedText: needle };
  }
  return {
    start: idx,
    end: idx + needle.length,
    matchedText: text.slice(idx, idx + needle.length),
  };
}

/** Append geo nodes только если mergeKey ещё не покрыт (LLM gap-fill, не дубли geo). */
export function appendCandidatesFromGeoNodes(input: {
  workspace: ParseWorkspace;
  nodes: GeoNode[];
  authorProcessorId: string;
  authorEnricherId: EnricherId;
  defaultEventType?: string;
  onlyMissingMergeKeys?: boolean;
}): void {
  const text = input.workspace.groomedText;
  const existingKeys = new Set(
    listActiveCandidates(input.workspace).map((candidate) => candidate.mergeKey),
  );

  for (const node of input.nodes) {
    if (!node.name?.trim()) continue;
    const span = findSpan(text, node.name);
    const anchorKind = node.kind === "region" ? "region" : "place";
    const mergeKey = buildCandidateMergeKey({
      spanStart: span.start,
      spanEnd: span.end,
      anchorKind,
      anchorName: node.name,
      regionCode: node.regionCode,
    });
    if (input.onlyMissingMergeKeys && existingKeys.has(mergeKey)) continue;

    const extras: Record<string, unknown> = {};
    if (typeof node.confidence === "number") {
      extras.llmConfidence = node.confidence;
    }
    if (typeof node.reason === "string" && node.reason.trim()) {
      extras.llmReason = node.reason;
    }

    appendCandidate({
      workspace: input.workspace,
      authorProcessorId: input.authorProcessorId,
      authorEnricherId: input.authorEnricherId,
      anchor: {
        kind: anchorKind,
        name: node.name,
        regionCode: node.regionCode,
        placeFias: node.fiasId,
        lat: node.lat,
        lon: node.lon,
        span,
      },
      eventType: "unknown",
      extras,
      provenance: {
        eventTypeSource: "pending",
        anchorSource: input.authorProcessorId,
      },
    });
    existingKeys.add(mergeKey);
  }
}
