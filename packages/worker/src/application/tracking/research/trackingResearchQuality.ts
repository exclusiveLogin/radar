/**
 * ---
 * layer: worker/application
 * domain: tracking/research
 * purpose: Метрики качества треков для offline research (фрагментация, физичность линков).
 * ---
 */
import type { ProfileKinematics } from "@radar/shared";
import { resolveProfileKinematics, type TrackingCandidate, type TrackingPipelineConfig } from "@radar/shared";
import type { TrackingResearchArtifact } from "./trackingResearchHarness.js";

export type TrackingResearchQuality = {
  /** Доля назначенных точек, лежащих в треках длиной ≥ 3 нод. */
  shareInTracksGe3: number;
  avgNodesPerTrack: number;
  medianNodesPerTrack: number;
  singleNodeTrackShare: number;
  tracksGe3: number;
  tracksTotal: number;
  /** Линки с distance ≈ 0 (дубликаты места, не движение). */
  zeroDistanceLinks: number;
  linksTotal: number;
  medianLinkDistanceM: number;
  medianLinkVelocityMs: number;
  /** Физически допустимые пары окна и доля принятых линков среди них. */
  feasiblePairs: number;
  acceptedFeasiblePairs: number;
  feasibleRecall: number;
};

const ZERO_DISTANCE_EPS_M = 1;

/**
 * Считает fragmentation / физичность по уже собранному research-артефакту
 * и исходному окну кандидатов.
 */
export function computeTrackingResearchQuality(
  artifact: Pick<TrackingResearchArtifact, "tracks" | "links">,
  candidates: readonly TrackingCandidate[],
  config: TrackingPipelineConfig,
): TrackingResearchQuality {
  const lengths = artifact.tracks.map(track => track.eventLocationIds.length);
  const assigned = lengths.reduce((sum, n) => sum + n, 0);
  const inGe3 = artifact.tracks
    .filter(track => track.eventLocationIds.length >= 3)
    .reduce((sum, track) => sum + track.eventLocationIds.length, 0);
  const singleNodeTracks = lengths.filter(n => n === 1).length;
  const distances = artifact.links.map(link => link.distanceM);
  const velocities = artifact.links.map(link => link.velocityMs);
  const zeroDistanceLinks = distances.filter(d => d <= ZERO_DISTANCE_EPS_M).length;

  const acceptedPairKeys = new Set(
    artifact.links.map(link => pairKey(link.fromEventLocationId, link.toEventLocationId)),
  );
  const feasible = collectFeasiblePairs(candidates, config);
  const acceptedFeasiblePairs = feasible.filter(key => acceptedPairKeys.has(key)).length;

  return {
    shareInTracksGe3: assigned === 0 ? 0 : inGe3 / assigned,
    avgNodesPerTrack: mean(lengths),
    medianNodesPerTrack: percentile(lengths, 0.5),
    singleNodeTrackShare: lengths.length === 0 ? 0 : singleNodeTracks / lengths.length,
    tracksGe3: lengths.filter(n => n >= 3).length,
    tracksTotal: lengths.length,
    zeroDistanceLinks,
    linksTotal: artifact.links.length,
    medianLinkDistanceM: percentile(distances, 0.5),
    medianLinkVelocityMs: percentile(velocities, 0.5),
    feasiblePairs: feasible.length,
    acceptedFeasiblePairs,
    feasibleRecall: feasible.length === 0 ? 0 : acceptedFeasiblePairs / feasible.length,
  };
}

/** Ненаправленные пары, проходящие maxGap / maxLink / maxVelocity профиля. */
function collectFeasiblePairs(
  candidates: readonly TrackingCandidate[],
  config: TrackingPipelineConfig,
): string[] {
  const byProfile = new Map<string, TrackingCandidate[]>();
  for (const candidate of candidates) {
    const list = byProfile.get(candidate.threatProfile) ?? [];
    list.push(candidate);
    byProfile.set(candidate.threatProfile, list);
  }

  const keys: string[] = [];
  for (const [profile, group] of byProfile) {
    const kin = resolveProfileKinematics(
      profile as TrackingCandidate["threatProfile"],
      config.profiles,
    );
    const sorted = [...group].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j]!;
        const dtMs = b.occurredAt.getTime() - a.occurredAt.getTime();
        if (dtMs <= 0 || dtMs > kin.maxGapMs) break;
        if (!isKinematicallyFeasible(a, b, dtMs, kin)) continue;
        keys.push(pairKey(a.eventLocationId, b.eventLocationId));
      }
    }
  }
  return keys;
}

function isKinematicallyFeasible(
  a: TrackingCandidate,
  b: TrackingCandidate,
  dtMs: number,
  kin: ProfileKinematics,
): boolean {
  const distM = haversineM(a.lat, a.lon, b.lat, b.lon);
  if (distM > kin.maxLinkDistanceM) return false;
  const speed = distM / Math.max(dtMs / 1000, 1);
  return speed <= kin.maxVelocityMs;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}->${toId}`;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1));
  return sorted[idx] ?? 0;
}
