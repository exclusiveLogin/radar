/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/flow
 * purpose: Построение индекса гравитации мест из истории кандидатов (pre-pass).
 * ---
 */
import { resolveProfileKinematics, type ProfileKinematics } from "../profileKinematics";
import { stdbscanMagnetize, DEFAULT_MAGNETIZE_WEIGHTS, type MagnetizeWeights } from "../stdbscan/stdbscanMagnetize";
import type { ThreatProfile, TrackingCandidate } from "../types";
import { zoneKeyForCandidate } from "./geohashZoneKey";
import { createPlaceGravityIndex, type PlaceGravityIndex } from "./placeGravityIndex";

type BuildGravityOpts = {
  magnetWeights?: Partial<MagnetizeWeights>;
  profileOverrides?: Partial<Record<ThreatProfile, Partial<ProfileKinematics>>>;
};

/**
 * Агрегирует массу winner-облаков по зонам за весь набор кандидатов.
 * Вызывается до magnetize с useHistoricalGravity для накопления hist-слоя.
 */
export function buildPlaceGravityIndexFromCandidates(
  candidates: TrackingCandidate[],
  opts: BuildGravityOpts = {},
): PlaceGravityIndex {
  const index = createPlaceGravityIndex();
  const weights: MagnetizeWeights = {
    ...DEFAULT_MAGNETIZE_WEIGHTS,
    ...opts.magnetWeights,
    useHistoricalGravity: false,
  };
  const geohashPrecision = weights.geohashPrecision;

  const byProfile = groupByProfile(candidates);
  for (const profile of Object.keys(byProfile) as ThreatProfile[]) {
    const kin = resolveProfileKinematics(profile, opts.profileOverrides);
    const batch = byProfile[profile]!;
    const { magnetism, candidates: enriched } = stdbscanMagnetize(
      batch,
      {
        epsilonSpatialM: kin.stdbscanEpsilonSpatialM,
        epsilonTemporalMs: kin.stdbscanEpsilonTemporalMs,
        minPts: kin.stdbscanMinPts,
      },
      weights,
    );
    for (const c of enriched) {
      const entry = magnetism.get(c.eventLocationId);
      if (!entry?.isWinner || entry.clusterMass <= 0) continue;
      const zoneKey = zoneKeyForCandidate(c.placeId, c.lat, c.lon, geohashPrecision);
      index.recordCluster(zoneKey, entry.clusterMass, c.lat, c.lon);
    }
  }
  return index;
}

function groupByProfile(
  candidates: TrackingCandidate[],
): Record<ThreatProfile, TrackingCandidate[]> {
  return candidates.reduce(
    (acc, c) => {
      (acc[c.threatProfile] ??= []).push(c);
      return acc;
    },
    {} as Record<ThreatProfile, TrackingCandidate[]>,
  );
}
