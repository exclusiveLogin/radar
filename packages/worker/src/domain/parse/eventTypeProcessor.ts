import type { ParseWorkspace } from "@radar/shared";
import { extractEventType } from "../parsing/extractEventType.js";
import { buildCandidateId } from "./candidateId.js";

/** EventTypeProcessor v1: legacy extractEventType; P4 — per-block context. */
export function runEventTypeProcessor(workspace: ParseWorkspace): string | null {
  const eventType = extractEventType(workspace.groomedText);
  if (!eventType) {
    return null;
  }

  if (workspace.candidates.length === 0) {
    const span = { start: 0, end: workspace.groomedText.length, matchedText: workspace.groomedText };
    workspace.candidates.push({
      id: buildCandidateId({
        rawMessageId: workspace.rawMessageId,
        spanStart: span.start,
        spanEnd: span.end,
        anchorKind: "system",
        anchorName: "message",
      }),
      anchor: {
        kind: "system",
        name: "message",
        span,
      },
      eventType,
      extras: {},
      provenance: {
        eventTypeSource: "event-type-processor",
        anchorSource: "system",
      },
    });
  } else {
    for (const block of workspace.blocks) {
      if (block.kind !== "geo" && block.kind !== "signal") continue;
      const localType = extractEventType(block.text);
      if (!localType) continue;
      const related = workspace.candidates.find(
        (candidate) =>
          candidate.anchor.span.start <= block.span.end
          && candidate.anchor.span.end >= block.span.start,
      );
      if (related) {
        related.eventType = localType;
        related.provenance.eventTypeSource = "event-type-processor:context";
      }
    }

    for (const candidate of workspace.candidates) {
      if (candidate.eventType === "unknown") {
        candidate.eventType = eventType;
        candidate.provenance.eventTypeSource = "event-type-processor";
      }
    }
  }

  return eventType;
}
