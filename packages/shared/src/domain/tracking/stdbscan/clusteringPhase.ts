/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/stdbscan
 * purpose: SSOT — выбор collapse vs magnet и подготовка кандидатов к assign.
 * ---
 */
import type { TrackingPipelineConfig } from "../../../schemas/admin/tracking";
import { DEFAULT_MAGNET_COST_WEIGHTS, type MagnetCostWeights, type MagnetismIndex } from "../applyMagnetWeights";
import { buildPlaceGravityIndexFromCandidates } from "../flow/buildPlaceGravityIndex";
import type { PlaceGravityIndex } from "../flow/placeGravityIndex";
import { resolveProfileKinematics, type ProfileKinematics } from "../profileKinematics";
import { DEFAULT_SEED_WEIGHTS } from "../pointWeightModel";
import type { SeedWeights } from "../pointWeightModel";
import type { ThreatProfile, TrackingCandidate } from "../types";
import { stdbscanDedup } from "./stdbscanDedup";
import {
  stdbscanMagnetize,
  pickMagnetWinnersForAssign,
  DEFAULT_MAGNETIZE_WEIGHTS,
  type MagnetizeWeights,
} from "./stdbscanMagnetize";

export type ClusteringPhaseResult = {
  candidates: TrackingCandidate[];
  magnetismIndex: MagnetismIndex;
  collapsedCount: number;
  winnerIds: Set<string>;
};

function resolveMagnetizeWeights(
  config: TrackingPipelineConfig | undefined,
  seedWeights: SeedWeights,
): MagnetizeWeights {
  const m = config?.magnet;
  return {
    lambdaCloud: m?.lambdaCloud ?? DEFAULT_MAGNETIZE_WEIGHTS.lambdaCloud,
    lambdaHist: m?.lambdaHist ?? DEFAULT_MAGNETIZE_WEIGHTS.lambdaHist,
    useHistoricalGravity: m?.useHistoricalGravity ?? DEFAULT_MAGNETIZE_WEIGHTS.useHistoricalGravity,
    geohashPrecision: m?.geohashPrecision ?? DEFAULT_MAGNETIZE_WEIGHTS.geohashPrecision,
    seedWeights,
  };
}

export function resolveMagnetCostWeights(config?: TrackingPipelineConfig): MagnetCostWeights {
  const m = config?.magnet;
  return {
    wMag: m?.wMag ?? DEFAULT_MAGNET_COST_WEIGHTS.wMag,
    wFlow: m?.wFlow ?? DEFAULT_MAGNET_COST_WEIGHTS.wFlow,
  };
}

/** Строит индекс исторической гравитации (pre-pass) при magnet + useHistoricalGravity. */
export function resolvePlaceGravityForRebuild(
  allCandidates: TrackingCandidate[],
  config?: TrackingPipelineConfig,
  seedWeights: SeedWeights = DEFAULT_SEED_WEIGHTS,
): PlaceGravityIndex | undefined {
  if (config?.clusteringMode !== "magnet") return undefined;
  if (!config.magnet?.useHistoricalGravity) return undefined;
  return buildPlaceGravityIndexFromCandidates(allCandidates, {
    magnetWeights: resolveMagnetizeWeights(config, seedWeights),
    profileOverrides: config.profiles,
  });
}

/** Кластеризация одного профиля: collapse или magnet. */
export function runClusteringForProfile(
  candidates: TrackingCandidate[],
  profile: ThreatProfile,
  config: TrackingPipelineConfig | undefined,
  seedWeights: SeedWeights,
  gravityIndex?: PlaceGravityIndex,
  reuseAcrossTracks = false,
): ClusteringPhaseResult {
  const kin = resolveProfileKinematics(profile, config?.profiles);
  const dbscanParams = {
    epsilonSpatialM: kin.stdbscanEpsilonSpatialM,
    epsilonTemporalMs: kin.stdbscanEpsilonTemporalMs,
    minPts: kin.stdbscanMinPts,
  };

  if (config?.clusteringMode === "magnet") {
    const { candidates: magnetized, magnetism } = stdbscanMagnetize(
      candidates,
      dbscanParams,
      resolveMagnetizeWeights(config, seedWeights),
      gravityIndex,
    );
    const winnerIds = new Set<string>();
    for (const [id, entry] of magnetism) {
      if (entry.isWinner) winnerIds.add(id);
    }
    const assignPool = reuseAcrossTracks
      ? magnetized
      : pickMagnetWinnersForAssign(magnetized, magnetism);
    const collapsedCount = reuseAcrossTracks
      ? 0
      : magnetized.length - assignPool.length;
    return { candidates: assignPool, magnetismIndex: magnetism, collapsedCount, winnerIds };
  }

  const { deduplicated, collapsedCount } = stdbscanDedup(candidates, dbscanParams);
  const winnerIds = new Set(deduplicated.map(c => c.eventLocationId));
  return {
    candidates: deduplicated,
    magnetismIndex: new Map(),
    collapsedCount,
    winnerIds,
  };
}

/** Объединяет magnetism maps нескольких профилей. */
export function mergeMagnetismIndexes(maps: MagnetismIndex[]): MagnetismIndex {
  const merged: MagnetismIndex = new Map();
  for (const m of maps) {
    for (const [k, v] of m) merged.set(k, v);
  }
  return merged;
}
