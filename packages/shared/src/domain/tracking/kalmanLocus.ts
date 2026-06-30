/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Локус ассоциации — только Mahalanobis по innovation covariance S = H·P·Hᵀ + R.
 * ---
 */
import {
  alignCovarianceToVelocity,
  innovationCovariance,
  latLonToMeters,
  predictKalmanState,
} from "./predictKalmanState";
import type { ObservationCovariance } from "./observationCovariance";
import type { KalmanStateJson } from "./types";

/** dt для debug-эллипса: predict вперёд по скорости, без раздувания на часы. */
export function kalmanLocusDebugDtSeconds(
  lastAtMs: number,
  asOfMs: number,
  capSeconds = 5 * 60,
  minSeconds = 60,
): number {
  const gap = Math.max(0, (asOfMs - lastAtMs) / 1000);
  const capped = Math.min(gap > 0 ? gap : minSeconds, capSeconds);
  return Math.max(capped, minSeconds);
}
export function normalizedKalmanRho(dM2: number, chi2Threshold: number): number {
  const chi2 = Math.max(chi2Threshold, 1e-9);
  return Math.sqrt(Math.max(0, dM2) / chi2);
}

/** Строгий локус: d² ≤ χ². */
export function inKalmanLocus(dM2: number, chi2Threshold: number): boolean {
  return dM2 <= chi2Threshold;
}

/** Мягкий локус: ρ ≤ multiplier (d² ≤ χ²·multiplier²). */
export function inKalmanSoftLocus(
  dM2: number,
  chi2Threshold: number,
  multiplier = 2,
): boolean {
  const m = Math.max(multiplier, 1);
  return dM2 <= chi2Threshold * m * m;
}

export type KalmanLocusEllipseInput = {
  state: KalmanStateJson;
  refLat: number;
  refLon: number;
  dtSeconds: number;
  R: ObservationCovariance;
  processNoiseScale: number;
  chi2Threshold: number;
  pauseFactor?: number;
  steps?: number;
  /** Потолок полуоси (м) — для debug-карты. */
  maxSemiAxisM?: number;
  /** σ_along/σ_cross для ориентации «огурца» вдоль скорости (≥1). */
  anisotropyRatio?: number;
};

/** Контур χ²-эллипса S вокруг predict-позиции (для debug-карты). */
export function kalmanLocusEllipseRing(
  input: KalmanLocusEllipseInput,
): [number, number][] | null {
  const pred = predictKalmanState(
    input.state,
    input.dtSeconds,
    input.processNoiseScale,
    input.pauseFactor ?? 1,
  );
  const Siso = innovationCovariance(pred.PPred, input.R.sigmaLonM, input.R.sigmaLatM);
  const S = alignCovarianceToVelocity(
    Siso,
    pred.vxPred,
    pred.vyPred,
    input.anisotropyRatio ?? 1,
  );
  const axesRaw = ellipseSemiAxesM(S, input.chi2Threshold);
  if (!axesRaw) return null;

  const axes = clipSemiAxes(axesRaw, input.maxSemiAxisM);
  if (!axes) return null;

  const ref = latLonToMeters(input.refLat, input.refLon, input.refLat, input.refLon);
  const center = {
    xM: pred.xPred,
    yM: pred.yPred,
    metersPerDegLon: ref.metersPerDegLon,
    metersPerDegLat: ref.metersPerDegLat,
  };

  const steps = input.steps ?? 32;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const xM = center.xM + axes.axis1[0] * Math.cos(t) + axes.axis2[0] * Math.sin(t);
    const yM = center.yM + axes.axis1[1] * Math.cos(t) + axes.axis2[1] * Math.sin(t);
    const lon = input.refLon + xM / Math.max(center.metersPerDegLon, 1);
    const lat = input.refLat + yM / center.metersPerDegLat;
    ring.push([lon, lat]);
  }
  return ring;
}

/** Полуоси эллипса d²=χ² для симметричной 2×2 S. */
function ellipseSemiAxesM(
  S: [[number, number], [number, number]],
  chi2: number,
): { axis1: [number, number]; axis2: [number, number] } | null {
  const a = S[0][0];
  const b = S[0][1];
  const c = S[1][1];
  const trace = a + c;
  const det = a * c - b * b;
  const disc = Math.max(0, (trace * trace) / 4 - det);
  const root = Math.sqrt(disc);
  const l1 = trace / 2 + root;
  const l2 = trace / 2 - root;
  if (l1 <= 0 || l2 <= 0) return null;

  // axis2 строго ⊥ axis1 — иначе при изотропной S (a≈c, b≈0) обе оси
  // схлопывались в одно направление и эллипс вырождался в линию.
  const v1 = eigenVector(a, b, c, l1);
  const v2: [number, number] = [-v1[1], v1[0]];
  const s1 = Math.sqrt(l1 * chi2);
  const s2 = Math.sqrt(l2 * chi2);
  return {
    axis1: [v1[0] * s1, v1[1] * s1],
    axis2: [v2[0] * s2, v2[1] * s2],
  };
}

function eigenVector(a: number, b: number, c: number, lambda: number): [number, number] {
  if (Math.abs(b) > 1e-9) {
    return normalize([b, lambda - a]);
  }
  // Диагональная S: ось вдоль x, если λ соответствует a, иначе вдоль y.
  return a >= c ? [1, 0] : [0, 1];
}

function normalize(v: [number, number]): [number, number] {
  const len = Math.hypot(v[0], v[1]);
  if (len < 1e-9) return [1, 0];
  return [v[0] / len, v[1] / len];
}

/** Ужимает эллипс до потолка полуоси (debug), сохраняя форму. */
function clipSemiAxes(
  axes: { axis1: [number, number]; axis2: [number, number] },
  maxSemiAxisM?: number,
): { axis1: [number, number]; axis2: [number, number] } | null {
  const len1 = Math.hypot(axes.axis1[0], axes.axis1[1]);
  const len2 = Math.hypot(axes.axis2[0], axes.axis2[1]);
  if (len1 < 1 || len2 < 1) return null;
  if (maxSemiAxisM == null || maxSemiAxisM <= 0) return axes;
  const maxLen = Math.max(len1, len2);
  if (maxLen <= maxSemiAxisM) return axes;
  const s = maxSemiAxisM / maxLen;
  return {
    axis1: [axes.axis1[0] * s, axes.axis1[1] * s],
    axis2: [axes.axis2[0] * s, axes.axis2[1] * s],
  };
}
