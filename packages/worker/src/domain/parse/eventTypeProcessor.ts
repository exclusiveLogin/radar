import type { ParseWorkspace } from "@radar/shared";
import { extractEventType } from "../parsing/extractEventType.js";
import { appendCandidate, listCandidatesByAuthor } from "./parseProcessorContract.js";
import { isChannelWideMassClearText } from "./massClearScope.js";

const AUTHOR = "event-type-processor";
const ENRICHER = "catalog";
const GEO_AUTHOR = "geo-processor";

/** EventTypeProcessor: append type overlays (не in-place mutate чужих candidates). */
export function runEventTypeProcessor(workspace: ParseWorkspace): string | null {
  const eventType = extractEventType(workspace.groomedText);
  if (!eventType) {
    return null;
  }

  const geoCandidates = listCandidatesByAuthor(workspace, GEO_AUTHOR);

  if (geoCandidates.length === 0) {
    if (isChannelWideMassClearText(workspace.groomedText)) {
      return eventType;
    }
    const span = {
      start: 0,
      end: workspace.groomedText.length,
      matchedText: workspace.groomedText,
    };
    appendCandidate({
      workspace,
      authorProcessorId: AUTHOR,
      authorEnricherId: ENRICHER,
      anchor: {
        kind: "system",
        name: "message",
        span,
      },
      eventType,
      provenance: {
        eventTypeSource: AUTHOR,
        anchorSource: "system",
      },
    });
    return eventType;
  }

  for (const block of workspace.blocks) {
    if (block.kind !== "geo" && block.kind !== "signal") continue;
    const localType = extractEventType(block.text);
    if (!localType) continue;

    for (const geo of geoCandidates) {
      const overlaps =
        geo.anchor.span.start <= block.span.end
        && geo.anchor.span.end >= block.span.start;
      if (!overlaps) continue;

      appendCandidate({
        workspace,
        authorProcessorId: AUTHOR,
        authorEnricherId: ENRICHER,
        anchor: { ...geo.anchor },
        eventType: localType,
        extras: { ...geo.extras },
        provenance: {
          eventTypeSource: `${AUTHOR}:context`,
          anchorSource: geo.provenance.anchorSource,
          blockId: block.id,
        },
      });
    }
  }

  for (const geo of geoCandidates) {
    const hasOverlay = workspace.candidates.some(
      (c) =>
        c.authorProcessorId === AUTHOR
        && c.mergeKey === geo.mergeKey
        && c.status === "active",
    );
    if (hasOverlay) continue;

    appendCandidate({
      workspace,
      authorProcessorId: AUTHOR,
      authorEnricherId: ENRICHER,
      anchor: { ...geo.anchor },
      eventType,
      extras: { ...geo.extras },
      provenance: {
        eventTypeSource: AUTHOR,
        anchorSource: geo.provenance.anchorSource,
      },
    });
  }

  return eventType;
}
