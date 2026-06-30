/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/flow
 * purpose: Phase W — эмпирический corridor index из потока событий до assign.
 *          Соседние по времени пары place_id одного профиля → count на рёбрах P2P.
 * ---
 */
import { resolveProfileKinematics, type ProfileKinematics } from "../profileKinematics";
import { haversineDistanceM } from "../haversine";
import type { ThreatProfile, TrackingCandidate } from "../types";
import { createCorridorRollupIndex, type CorridorRollupIndex } from "./corridorRollupIndex";

export type BuildCorridorOpts = {
  /** Профильные overrides из config пайплайна. */
  profileOverrides?: Partial<Record<ThreatProfile, Partial<ProfileKinematics>>>;
  /** Макс. разрыв между соседними событиями для записи ребра (мс). По умолчанию — ε_temporal профиля. */
  maxGapMs?: Partial<Record<ThreatProfile, number>>;
};

/** Физический потолок длины ребра: v_max·Δt + ε_spatial (не maxGapMs 3ч). */
export function corridorMaxSpatialM(
  gapMs: number,
  kin: ProfileKinematics,
): number {
  const dtSec = Math.max(0, gapMs) / 1000;
  return kin.maxVelocityMs * dtSec + kin.stdbscanEpsilonSpatialM;
}

/**
 * Строит frozen corridor index из хронологического потока кандидатов.
 * Только пары в одном temporal окне и в пределах физической дальности полёта.
 */
export function buildCorridorFromCandidates(
  candidates: TrackingCandidate[],
  opts: BuildCorridorOpts = {},
): CorridorRollupIndex {
  const index = createCorridorRollupIndex();
  const byProfile = groupByProfile(candidates);

  for (const profile of Object.keys(byProfile) as ThreatProfile[]) {
    const kin = resolveProfileKinematics(profile, opts.profileOverrides);
    // ε_temporal (≈20 мин UAV), не maxGapMs (3 ч) — иначе склеиваются несвязанные репорты
    const maxGapMs = opts.maxGapMs?.[profile] ?? kin.stdbscanEpsilonTemporalMs;
    const sorted = [...byProfile[profile]!].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (!prev.placeId || !cur.placeId) continue;
      if (prev.placeId === cur.placeId) continue;

      const gapMs = cur.occurredAt.getTime() - prev.occurredAt.getTime();
      if (gapMs <= 0 || gapMs > maxGapMs) continue;

      const distM = haversineDistanceM(prev.lat, prev.lon, cur.lat, cur.lon);
      if (distM > corridorMaxSpatialM(gapMs, kin)) continue;

      index.recordPass(
        prev.placeId,
        cur.placeId,
        prev.lat,
        prev.lon,
        cur.lat,
        cur.lon,
        profile,
      );
    }
  }

  return index;
}

/**
 * Разбивает кандидатов на temporal slices для GNN assign.
 * Внутри slice Kalman-состояния треков считаются frozen; между slice — обновление.
 */
export function temporalAssignSlices(
  candidates: TrackingCandidate[],
  maxSpanMs: number,
): TrackingCandidate[][] {
  const sorted = [...candidates].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  if (sorted.length === 0) return [];

  const slices: TrackingCandidate[][] = [];
  let current: TrackingCandidate[] = [];
  let sliceStartMs = sorted[0]!.occurredAt.getTime();

  for (const c of sorted) {
    const t = c.occurredAt.getTime();
    if (current.length === 0) {
      current.push(c);
      sliceStartMs = t;
      continue;
    }
    if (t - sliceStartMs <= maxSpanMs) {
      current.push(c);
    } else {
      slices.push(current);
      current = [c];
      sliceStartMs = t;
    }
  }
  if (current.length > 0) slices.push(current);
  return slices;
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
