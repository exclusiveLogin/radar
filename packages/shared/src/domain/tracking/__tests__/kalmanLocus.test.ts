import { describe, expect, test } from "vitest";
import { kalmanInitState } from "../kalmanStep";
import {
  inKalmanLocus,
  inKalmanSoftLocus,
  kalmanLocusDebugDtSeconds,
  kalmanLocusEllipseRing,
  normalizedKalmanRho,
} from "../kalmanLocus";
import { scoreInnovation } from "../innovationScore";
import { PROFILE_KINEMATICS } from "../profileKinematics";

describe("kalmanLocus", () => {
  test("ρ=1 на границе χ²", () => {
    expect(normalizedKalmanRho(18, 18)).toBeCloseTo(1, 5);
    expect(inKalmanLocus(17, 18)).toBe(true);
    expect(inKalmanLocus(19, 18)).toBe(false);
  });

  test("soft: d² ≤ 4χ²", () => {
    expect(inKalmanSoftLocus(72, 18, 2)).toBe(true);
    expect(inKalmanSoftLocus(73, 18, 2)).toBe(false);
  });

  test("эллипс строится вокруг predict", () => {
    const refLat = 50;
    const refLon = 36;
    const state = kalmanInitState(50, 36, refLat, refLon, 1000, 50);
    const kin = PROFILE_KINEMATICS.uav;
    const ring = kalmanLocusEllipseRing({
      state,
      refLat,
      refLon,
      dtSeconds: 0,
      R: { sigmaLatM: 5000, sigmaLonM: 5000 },
      processNoiseScale: kin.processNoiseScale,
      chi2Threshold: kin.chi2Threshold,
      maxSemiAxisM: 120_000,
    });
    expect(ring?.length).toBeGreaterThan(10);
  });

  test("predict с скоростью даёт вытянутый эллипс", () => {
    const refLat = 50;
    const refLon = 36;
    const state = kalmanInitState(50, 36, refLat, refLon, 1000, 50);
    state.vx = 45;
    state.vy = 8;
    state.P = [
      [2e6, 5e5, 1e5, 0],
      [5e5, 1.5e6, 0, 8e4],
      [1e5, 0, 3e5, 0],
      [0, 8e4, 0, 3e5],
    ];
    const kin = PROFILE_KINEMATICS.uav;
    const ring = kalmanLocusEllipseRing({
      state,
      refLat,
      refLon,
      dtSeconds: 180,
      R: { sigmaLatM: 3000, sigmaLonM: 3000 },
      processNoiseScale: kin.processNoiseScale,
      chi2Threshold: kin.chi2Threshold,
      maxSemiAxisM: 1_000_000,
    });
    expect(ring?.length).toBeGreaterThan(10);
    const xs = ring!.map(p => p[0]);
    const ys = ring!.map(p => p[1]);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    const ratio = Math.max(width, height) / Math.max(Math.min(width, height), 1e-9);
    expect(ratio).toBeGreaterThan(1.15);
  });

  test("kalmanLocusDebugDtSeconds: cap 5 мин", () => {
    const last = Date.parse("2024-01-01T00:00:00Z");
    const asOf = last + 5 * 3600_000;
    expect(kalmanLocusDebugDtSeconds(last, asOf)).toBe(5 * 60);
  });

  test("длинный predict клипуется maxSemiAxisM", () => {
    const refLat = 50;
    const refLon = 36;
    const state = kalmanInitState(50, 36, refLat, refLon, 1000, 50);
    const kin = PROFILE_KINEMATICS.uav;
    const ring = kalmanLocusEllipseRing({
      state,
      refLat,
      refLon,
      dtSeconds: 10_800,
      R: { sigmaLatM: 5000, sigmaLonM: 5000 },
      processNoiseScale: kin.processNoiseScale,
      chi2Threshold: kin.chi2Threshold,
      maxSemiAxisM: 120_000,
    });
    expect(ring?.length).toBeGreaterThan(10);
  });

  test("gate attention = scoreInnovation.inLocus", () => {
    const refLat = 50;
    const refLon = 36;
    const state = kalmanInitState(50, 36, refLat, refLon, 1000, 50);
    const kin = PROFILE_KINEMATICS.uav;
    const scored = scoreInnovation({
      state,
      observationLat: 50.001,
      observationLon: 36.001,
      dtSeconds: 60,
      R: { sigmaLonM: 5000, sigmaLatM: 5000 },
      refLat,
      refLon,
      processNoiseScale: kin.processNoiseScale,
      chi2Threshold: kin.chi2Threshold,
      maxVelocityMs: kin.maxVelocityMs,
      rearThresholdM: kin.rearThresholdM,
    });
    expect(inKalmanLocus(scored.dM2, kin.chi2Threshold)).toBe(scored.inLocus);
  });
});
