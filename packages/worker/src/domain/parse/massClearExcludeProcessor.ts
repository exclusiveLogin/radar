import type { ParseWorkspace } from "@radar/shared";
import type { IPlaceScanPort } from "@radar/shared";
import {
  extractMassClearExcludeSegment,
  type MassClearWorkspaceState,
} from "./massClearScope.js";

function readMassClearState(workspace: ParseWorkspace): MassClearWorkspaceState {
  const existing = workspace.namespaces.massClear as MassClearWorkspaceState | undefined;
  return existing ?? { scope: "channel", excludedRegionCodes: [] };
}

/** Исключения из канального отбоя: явное «кроме …» → region ISO из DB scan. */
export function runMassClearExcludeProcessor(input: {
  workspace: ParseWorkspace;
  placeScan: IPlaceScanPort;
}): void {
  const { workspace, placeScan } = input;
  const excludeSegment = extractMassClearExcludeSegment(workspace.groomedText);
  if (!excludeSegment) return;

  const excludedRegionCodes = [
    ...new Set(
      placeScan.matchRegions(excludeSegment).map((hit) => hit.entry.regionIso),
    ),
  ];
  if (excludedRegionCodes.length === 0) return;

  workspace.namespaces.massClear = {
    ...readMassClearState(workspace),
    excludedRegionCodes,
  };
}
