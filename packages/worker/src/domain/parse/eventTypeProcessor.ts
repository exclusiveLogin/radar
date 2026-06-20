import type { ParseWorkspace } from "@radar/shared";
import { extractEventType } from "../parsing/extractEventType.js";
import { appendCandidate, listCandidatesByAuthor } from "./parseProcessorContract.js";
import { createTraitAttachment } from "./attachRule.js";
import { isChannelWideMassClearText } from "./massClearScope.js";
import { EVENT_TYPE_TRAIT_KEY } from "./resolveEventTypeForCandidate.js";

const AUTHOR = "event-type-processor";
const ENRICHER = "catalog";
const GEO_AUTHOR = "geo-processor";

/**
 * EventTypeProcessor: обогащает workspace traitAttachments, не клонирует geo-candidates.
 * Finalizer резолвит eventType через resolveEventTypeForCandidate.
 */
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

    workspace.traitAttachments.push(
      createTraitAttachment({
        processorId: AUTHOR,
        traitKey: EVENT_TYPE_TRAIT_KEY,
        value: localType,
        attachRule: { scope: "by_span_overlap", span: block.span },
      }),
    );
  }

  workspace.traitAttachments.push(
    createTraitAttachment({
      processorId: AUTHOR,
      traitKey: EVENT_TYPE_TRAIT_KEY,
      value: eventType,
      attachRule: { scope: "all_candidates" },
    }),
  );

  return eventType;
}
