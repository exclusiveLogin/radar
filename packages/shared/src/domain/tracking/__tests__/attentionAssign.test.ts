/**
 * Unit-тесты attention assign, eligibility, innovation score.
 */
import { describe, expect, test } from "vitest";
import { canEnterAttention, hasGeo } from "../trackingEligibility";
import { computeSeedScore, passesSeedThreshold, canSeedCandidate } from "../pointWeightModel";
import { canSeedByEventType } from "../eventTypeCoefficients";
import { resolveRowAssignment } from "../assignCandidates";
import { buildAttentionMatrix, type TrackAttentionTarget } from "../attentionMatrix";
import { scoreInnovation } from "../innovationScore";
import { kalmanInitState } from "../kalmanStep";
import { PROFILE_KINEMATICS } from "../profileKinematics";
import { computeTrackingFitness } from "../trackingFitness";
import type { TrackingCandidate } from "../types";

const UAV_KIN = PROFILE_KINEMATICS.uav;

function makeCandidate(overrides: Partial<TrackingCandidate> = {}): TrackingCandidate {
  return {
    eventLocationId: "loc-1",
    parsedEventId: "pe-1",
    occurredAt: new Date("2024-06-01T12:00:00Z"),
    lat: 50.0,
    lon: 36.0,
    placeId: null,
    precision: "coords",
    trust: 0.9,
    eventType: "fixation",
    eventCategory: null,
    affectsKinematics: true,
    isFrontRegion: false,
    isInteriorRf: false,
    threatProfile: "uav",
    mode: "correct",
    sourceRefs: [],
    ...overrides,
  };
}

describe("eligibility + seed weights", () => {
  test("нет geo → canEnterAttention false", () => {
    expect(hasGeo({ lat: null as unknown as number, lon: 36 })).toBe(false);
    expect(canEnterAttention(makeCandidate({ lat: null as unknown as number }))).toBe(false);
  });

  test("seedMult: fixation > danger > warning", () => {
    const base = { precision: "coords", trust: 1, isFrontRegion: false, isInteriorRf: false };
    const f = computeSeedScore(makeCandidate({ eventType: "fixation", ...base }));
    const d = computeSeedScore(makeCandidate({ eventType: "danger", ...base }));
    const w = computeSeedScore(makeCandidate({ eventType: "warning", ...base }));
    expect(f).toBeGreaterThan(d);
    expect(d).toBeGreaterThan(w);
  });

  test("pvo/intercept seedMult=0", () => {
    expect(canSeedByEventType("pvo_work")).toBe(false);
    expect(canSeedByEventType("intercept")).toBe(false);
    expect(computeSeedScore(makeCandidate({ eventType: "intercept" }))).toBe(0);
  });

  test("front_region beats interior RF", () => {
    const interior = computeSeedScore(makeCandidate({ isInteriorRf: true }));
    const front = computeSeedScore(makeCandidate({ isFrontRegion: true, isInteriorRf: false }));
    expect(front).toBeGreaterThan(interior);
  });
});

describe("assign decisions", () => {
  test("intercept не seed", () => {
    const row = {
      candidate: makeCandidate({ eventType: "intercept" }),
      links: [],
      seedScore: 0,
    };
    const d = resolveRowAssignment(row, UAV_KIN, { consumed: new Set() })[0]!;
    expect(d?.kind).toBe("skip");
  });

  test("intercept закрывает winner track", () => {
    const row = {
      candidate: makeCandidate({ eventType: "intercept" }),
      links: [{ trackId: "t1", linkCost: 1, rho: 0.5, rhoPrime: 0.5, dM2: 0.25, inLocus: true, softEligible: false }],
      seedScore: 0,
    };
    const d = resolveRowAssignment(row, UAV_KIN, { consumed: new Set() })[0]!;
    expect(d?.kind).toBe("intercept");
    if (d?.kind === "intercept") expect(d.trackId).toBe("t1");
  });

  test("interior RF fixation без winner → no seed если ниже порога", () => {
    const low = makeCandidate({
      eventType: "warning",
      isInteriorRf: true,
      precision: "locality",
      trust: 0.3,
    });
    expect(passesSeedThreshold(low)).toBe(false);
  });

  test("глубина РФ (front_distance > 450км) не seed — только link", () => {
    const deep = makeCandidate({
      eventType: "fixation",
      precision: "coords",
      trust: 0.9,
      frontDistanceKm: 700,
      isInteriorRf: true,
    });
    expect(canSeedCandidate(deep)).toBe(false);
  });

  test("приграничье (front_distance < 450км) может seed", () => {
    const near = makeCandidate({
      eventType: "fixation",
      precision: "coords",
      trust: 0.9,
      frontDistanceKm: 120,
      isFrontRegion: false,
    });
    expect(canSeedCandidate(near)).toBe(true);
  });

  test("reuseAcrossTracks: in-locus к двум трекам → оба link", () => {
    const row = {
      candidate: makeCandidate(),
      links: [
        { trackId: "t1", linkCost: 0.8, rho: 0.8, rhoPrime: 0.8, dM2: 0.64, inLocus: true, softEligible: false },
        { trackId: "t2", linkCost: 0.9, rho: 0.9, rhoPrime: 0.9, dM2: 0.81, inLocus: true, softEligible: false },
      ],
      seedScore: 0.5,
    };
    const decisions = resolveRowAssignment(row, UAV_KIN, {
      consumed: new Set(),
      reuseAcrossTracks: true,
    });
    expect(decisions).toHaveLength(2);
    expect(decisions.every(d => d.kind === "link")).toBe(true);
  });
});

describe("innovation score cucumber", () => {
  test("вдоль вектора D_M меньше чем поперёк", () => {
    const refLat = 50;
    const refLon = 36;
    const state = kalmanInitState(50, 36, refLat, refLon, 1000, 50);
    state.vx = 50;
    state.vy = 0;

    const along = scoreInnovation({
      state,
      observationLat: 50.001,
      observationLon: 36.01,
      dtSeconds: 60,
      R: { sigmaLonM: 5000, sigmaLatM: 5000 },
      refLat,
      refLon,
      processNoiseScale: 0.8,
      chi2Threshold: 25,
      maxVelocityMs: 70,
      rearThresholdM: 30000,
    });

    const across = scoreInnovation({
      state,
      observationLat: 50.05,
      observationLon: 36.01,
      dtSeconds: 60,
      R: { sigmaLonM: 5000, sigmaLatM: 5000 },
      refLat,
      refLon,
      processNoiseScale: 0.8,
      chi2Threshold: 25,
      maxVelocityMs: 70,
      rearThresholdM: 30000,
    });

    expect(along.dM2).toBeLessThan(across.dM2);
  });

  test("rear_front: точка позади скорости отклоняется", () => {
    const refLat = 50;
    const refLon = 36;
    const state = kalmanInitState(50, 36, refLat, refLon, 1000, 50);
    state.vx = 50;
    state.vy = 0;

    const behind = scoreInnovation({
      state,
      observationLat: 50,
      observationLon: 36,
      dtSeconds: 3600,
      R: { sigmaLonM: 5000, sigmaLatM: 5000 },
      refLat,
      refLon,
      processNoiseScale: 0.8,
      chi2Threshold: PROFILE_KINEMATICS.uav.chi2Threshold,
      maxVelocityMs: 70,
      rearThresholdM: PROFILE_KINEMATICS.uav.rearThresholdM,
    });

    expect(behind.rejectReason).toBe("rear_front");
    expect(behind.inLocus).toBe(false);
  });
});

describe("tracking fitness", () => {
  test("штрафует монотрек (degeneracy)", () => {
    const mono = computeTrackingFitness({
      totalPoints: 100,
      trackLengths: [100],
      meanAcceptDM: 2,
      orphanCount: 0,
    });
    const balanced = computeTrackingFitness({
      totalPoints: 100,
      trackLengths: [25, 25, 25, 25],
      meanAcceptDM: 2,
      orphanCount: 0,
    });
    expect(balanced.fitness).toBeGreaterThan(mono.fitness);
  });
});

describe("attention matrix profile filter", () => {
  test("rocket candidate только с rocket track", () => {
    const rocket = makeCandidate({ threatProfile: "rocket", lat: 48, lon: 37 });
    const uavTrack: TrackAttentionTarget = {
      trackId: "u1",
      profile: "uav",
      lastAt: new Date("2024-06-01T11:00:00Z"),
      lastLat: 48,
      lastLon: 37,
      lastPlaceId: null,
      kalmanState: null,
      refLat: 48,
      refLon: 37,
    };
    const rows = buildAttentionMatrix([rocket], [uavTrack], PROFILE_KINEMATICS.rocket);
    expect(rows[0]?.links.length).toBe(0);
  });
});
