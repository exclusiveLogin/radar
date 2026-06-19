import type { ParseWorkspace } from "@radar/shared";
import type { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";
import {
  extractMassClearExcludeSegment,
  type MassClearWorkspaceState,
} from "./massClearScope.js";

function readMassClearState(workspace: ParseWorkspace): MassClearWorkspaceState {
  const existing = workspace.namespaces.massClear as MassClearWorkspaceState | undefined;
  return existing ?? { scope: "channel", excludedRegionCodes: [] };
}

/**
 * Исключения из канального отбоя: только явное «кроме …».
 * Регионы в основном тексте («в том числе по Воронежской») сюда не попадают.
 */
export function runMassClearExcludeProcessor(input: {
  workspace: ParseWorkspace;
  geoCatalog: GeoCatalog;
}): void {
  const { workspace, geoCatalog } = input;
  const excludeSegment = extractMassClearExcludeSegment(workspace.groomedText);
  if (!excludeSegment) return;

  const excludedRegionCodes = [
    ...new Set(
      geoCatalog.findRegions(excludeSegment).map((region) => region.code),
    ),
  ];
  if (excludedRegionCodes.length === 0) return;

  workspace.namespaces.massClear = {
    ...readMassClearState(workspace),
    excludedRegionCodes,
  };
}
