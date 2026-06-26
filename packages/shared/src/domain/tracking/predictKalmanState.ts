/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Predict-only шаг Kalman (без correct) для attention matrix.
 * ---
 */
import type { KalmanStateJson } from "./types";

type Mat4 = number[][];

function mat4zero(): Mat4 {
  return Array.from({ length: 4 }, () => [0, 0, 0, 0]);
}

function mat4mul(A: Mat4, B: Mat4): Mat4 {
  const C = mat4zero();
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++) C[i][j] += A[i][k] * B[k][j];
  return C;
}

function mat4add(A: Mat4, B: Mat4): Mat4 {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

function mat4transpose(A: Mat4): Mat4 {
  return A[0].map((_, j) => A.map(row => row[j]));
}

export type PredictResult = {
  xPred: number;
  yPred: number;
  vxPred: number;
  vyPred: number;
  PPred: Mat4;
};

/**
 * Predict Kalman state на dt секунд вперёд.
 * @param processNoiseScale — базовый Q; умножается на pauseFactor при soft-assign.
 */
export function predictKalmanState(
  state: KalmanStateJson,
  dtSeconds: number,
  processNoiseScale: number,
  pauseFactor: number = 1,
): PredictResult {
  if (dtSeconds <= 0) {
    return {
      xPred: state.x,
      yPred: state.y,
      vxPred: state.vx,
      vyPred: state.vy,
      PPred: state.P as Mat4,
    };
  }

  const dt = dtSeconds;
  const F: Mat4 = [
    [1, 0, dt, 0],
    [0, 1, 0, dt],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];

  const q = processNoiseScale * pauseFactor;
  const dt3 = (dt ** 3) / 3;
  const dt2 = (dt ** 2) / 2;
  const Q: Mat4 = [
    [q * dt3, 0, q * dt2, 0],
    [0, q * dt3, 0, q * dt2],
    [q * dt2, 0, q * dt, 0],
    [0, q * dt2, 0, q * dt],
  ];

  const P = state.P as Mat4;
  const xPred = state.x + state.vx * dt;
  const yPred = state.y + state.vy * dt;
  const PPred = mat4add(mat4mul(mat4mul(F, P), mat4transpose(F)), Q);

  return {
    xPred,
    yPred,
    vxPred: state.vx,
    vyPred: state.vy,
    PPred,
  };
}

/** Innovation covariance S = H·P·Hᵀ + R (2×2). */
export function innovationCovariance(
  PPred: Mat4,
  sigmaLonM: number,
  sigmaLatM: number,
): [[number, number], [number, number]] {
  const R00 = sigmaLonM ** 2;
  const R11 = sigmaLatM ** 2;
  return [
    [PPred[0][0] + R00, PPred[0][1]],
    [PPred[1][0], PPred[1][1] + R11],
  ];
}

/** Конвертация lat/lon в метры от ref. */
export function latLonToMeters(
  lat: number,
  lon: number,
  refLat: number,
  refLon: number,
): { xM: number; yM: number; metersPerDegLon: number; metersPerDegLat: number } {
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((refLat * Math.PI) / 180);
  return {
    xM: (lon - refLon) * metersPerDegLon,
    yM: (lat - refLat) * metersPerDegLat,
    metersPerDegLon,
    metersPerDegLat,
  };
}
