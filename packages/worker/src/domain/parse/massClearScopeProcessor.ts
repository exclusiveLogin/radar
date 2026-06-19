import type { ParseWorkspace } from "@radar/shared";
import { appendCandidate } from "./parseProcessorContract.js";
import {
  isChannelWideMassClearText,
  MASS_CLEAR_CHANNEL_EXTRAS_KEY,
  MASS_CLEAR_EXCLUDED_CODES_EXTRAS_KEY,
  type MassClearWorkspaceState,
} from "./massClearScope.js";

const AUTHOR = "mass-clear-scope-processor";
const ENRICHER = "catalog";

/**
 * Канальный отбой «по всем …» → append system-candidate cleared.
 * Collapse чужих region/place — в finalizer (candidateCollapsers).
 */
export function runMassClearScopeProcessor(workspace: ParseWorkspace): void {
  const text = workspace.groomedText;
  if (!isChannelWideMassClearText(text)) return;

  const massClearState = workspace.namespaces.massClear as MassClearWorkspaceState | undefined;
  const excludedRegionCodes = massClearState?.excludedRegionCodes ?? [];

  workspace.namespaces.massClear = {
    scope: "channel",
    excludedRegionCodes,
  };

  const span = { start: 0, end: text.length, matchedText: text };
  appendCandidate({
    workspace,
    authorProcessorId: AUTHOR,
    authorEnricherId: ENRICHER,
    anchor: {
      kind: "system",
      name: "channel-wide-clear",
      span,
    },
    eventType: "cleared",
    extras: {
      [MASS_CLEAR_CHANNEL_EXTRAS_KEY]: true,
      ...(excludedRegionCodes.length > 0
        ? { [MASS_CLEAR_EXCLUDED_CODES_EXTRAS_KEY]: excludedRegionCodes }
        : {}),
    },
    provenance: {
      eventTypeSource: AUTHOR,
      anchorSource: AUTHOR,
    },
    trust: 85,
  });
}
