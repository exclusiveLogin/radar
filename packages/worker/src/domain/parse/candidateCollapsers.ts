import type { EventCandidate, ParseWorkspace } from "@radar/shared";
import { MASS_CLEAR_CHANNEL_EXTRAS_KEY } from "./massClearScope.js";

/**
 * Collapser rules — только на этапе finalizer merge.
 * Processors append; finalizer сводит winners.
 */
export function applyCandidateCollapsers(
  winners: EventCandidate[],
  workspace: ParseWorkspace,
): EventCandidate[] {
  const hasChannelMassClear = winners.some(
    (c) => c.extras[MASS_CLEAR_CHANNEL_EXTRAS_KEY] === true,
  );
  if (!hasChannelMassClear) {
    return collapseGeoPlaceRegion(winners);
  }

  const massClearNs = workspace.namespaces.massClear as
    | { excludedRegionCodes?: string[] }
    | undefined;
  const excluded = new Set(massClearNs?.excludedRegionCodes ?? []);

  return winners.filter((candidate) => {
    if (candidate.extras[MASS_CLEAR_CHANNEL_EXTRAS_KEY] === true) {
      return true;
    }
    if (candidate.anchor.kind === "system") {
      return false;
    }
    if (
      candidate.anchor.kind === "region"
      && candidate.anchor.regionCode
      && excluded.has(candidate.anchor.regionCode)
    ) {
      return true;
    }
    return false;
  });
}

/** ADR-012: place + region same code → region winner убираем если есть place. */
function collapseGeoPlaceRegion(candidates: EventCandidate[]): EventCandidate[] {
  const placeRegionCodes = new Set(
    candidates
      .filter((c) => c.anchor.kind === "place" && c.anchor.regionCode)
      .map((c) => c.anchor.regionCode!),
  );
  return candidates.filter((candidate) => {
    if (candidate.anchor.kind !== "region") return true;
    const code = candidate.anchor.regionCode;
    if (!code) return true;
    return !placeRegionCodes.has(code);
  });
}
