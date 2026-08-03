import type { EventCandidate, ParseWorkspace } from "@radar/shared";
import { isChannelCityListPromo } from "../../parsing/channelCityListPromo.js";
import { listActiveCandidates } from "../parseProcessorContract.js";
import {
  computeGeoCandidateScore,
  type GeoScoreFactors,
  type GeoScoreMatrix,
} from "./geoCandidateScore.js";
import { loadGeoScoreMatrix } from "./geoScoreMatrixRegistry.js";
import { countHitsByRegionIso, isMinorityRegionHit } from "./regionMajority.js";

function readStemPoolSize(extras: Record<string, unknown>): number | undefined {
  const value = extras.stemPoolSize;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readLlmConfidence(extras: Record<string, unknown>): number | undefined {
  const value = extras.llmConfidence;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function collectExplicitRegionIsos(workspace: ParseWorkspace): Set<string> {
  const isos = new Set<string>();
  for (const candidate of listActiveCandidates(workspace)) {
    if (candidate.anchor.kind === "region" && candidate.anchor.regionCode) {
      isos.add(candidate.anchor.regionCode);
    }
  }
  return isos;
}

function buildFactors(input: {
  candidate: EventCandidate;
  regionHitCounts: Map<string, number>;
  explicitRegionIsos: Set<string>;
  geoConflict: boolean;
  channelPromo: boolean;
  matrix: GeoScoreMatrix;
}): GeoScoreFactors {
  const { candidate, matrix } = input;
  const extras = candidate.extras ?? {};
  const stemPoolSize = readStemPoolSize(extras);
  const regionIso = candidate.anchor.regionCode;

  const minorityRegion = isMinorityRegionHit({
    candidateRegionIso: regionIso,
    regionHitCounts: input.regionHitCounts,
    majorityClusterMin: matrix.majorityClusterMin,
  });

  const conflictForCandidate =
    input.geoConflict
    && Boolean(regionIso)
    && input.explicitRegionIsos.size > 0
    && !input.explicitRegionIsos.has(regionIso!);

  return {
    uniqueStem: stemPoolSize === 1,
    geoImprecise: extras.geoImprecise === true,
    matchedViaAdjectiveStem: extras.matchedViaAdjectiveStem === true,
    minorityRegion,
    geoConflict: conflictForCandidate,
    channelPromo: input.channelPromo,
    llmConfidence: readLlmConfidence(extras),
  };
}

/**
 * Аннотирует active geo-кандидатов extras.geoScore / geoScoreBreakdown.
 * Ничего не удаляет и не блокирует — только score (ADR-027).
 */
export function runGeoCandidateScoring(
  workspace: ParseWorkspace,
  matrix: GeoScoreMatrix = loadGeoScoreMatrix(),
): void {
  const active = listActiveCandidates(workspace).filter(
    (c) => c.anchor.kind === "place" || c.anchor.kind === "region",
  );
  if (active.length === 0) return;

  const placeIsos = active
    .filter((c) => c.anchor.kind === "place")
    .map((c) => c.anchor.regionCode);
  const regionHitCounts = countHitsByRegionIso(placeIsos);
  const explicitRegionIsos = collectExplicitRegionIsos(workspace);
  const geoConflict = workspace.namespaces.geoConflict === true;
  const channelPromo = isChannelCityListPromo(workspace.groomedText);

  for (const candidate of active) {
    const factors = buildFactors({
      candidate,
      regionHitCounts,
      explicitRegionIsos,
      geoConflict,
      channelPromo,
      matrix,
    });
    const { score, breakdown } = computeGeoCandidateScore(factors, matrix);
    candidate.extras = {
      ...candidate.extras,
      geoScore: score,
      geoScoreBreakdown: breakdown,
    };
  }
}
