/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Один шаг фильтра Калмана: predict + correct.
 *          Состояние: [x, y, vx, vy] (метры + м/с в локальной проекции).
 * ---
 */
import type { KalmanStateJson } from "./types";
import type { ObservationCovariance } from "./observationCovariance";

/** Матрица 4×4 как плоский массив. */
type Mat4 = number[][];

function mat4zero(): Mat4 {
  return Array.from({ length: 4 }, () => [0, 0, 0, 0]);
}

function mat4identity(): Mat4 {
  const m = mat4zero();
  for (let i = 0; i < 4; i++) m[i][i] = 1;
  return m;
}

function mat4mul(A: Mat4, B: Mat4): Mat4 {
  const C = mat4zero();
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++)
        C[i][j] += A[i][k] * B[k][j];
  return C;
}

function mat4add(A: Mat4, B: Mat4): Mat4 {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

function mat4transpose(A: Mat4): Mat4 {
  return A[0].map((_, j) => A.map(row => row[j]));
}

/**
 * Один predict + correct шаг фильтра Калмана.
 *
 * Модель движения: x_{k+1} = F·x_k + w_k
 * F = [[1,0,dt,0],[0,1,0,dt],[0,0,1,0],[0,0,0,1]]
 * H = [[1,0,0,0],[0,1,0,0]]
 * Q масштабируется от dt³/dt⁴ × processNoiseScale
 *
 * @returns Обновлённый KalmanStateJson
 */
export function kalmanStep(
  state: KalmanStateJson,
  observationLat: number,
  observationLon: number,
  dtSeconds: number,
  R: ObservationCovariance,
  processNoiseScale: number,
  refLat: number,
  refLon: number,
): KalmanStateJson {
  if (dtSeconds <= 0) return state;

  const dt = dtSeconds;

  // Конвертируем наблюдение в метры от ref
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((refLat * Math.PI) / 180);
  const obsX = (observationLon - refLon) * metersPerDegLon;
  const obsY = (observationLat - refLat) * metersPerDegLat;

  // Transition matrix F
  const F: Mat4 = [
    [1, 0, dt, 0],
    [0, 1, 0, dt],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];

  // Process noise Q (Wiener process model)
  const q = processNoiseScale;
  const dt3 = (dt ** 3) / 3;
  const dt2 = (dt ** 2) / 2;
  const Q: Mat4 = [
    [q * dt3, 0, q * dt2, 0],
    [0, q * dt3, 0, q * dt2],
    [q * dt2, 0, q * dt, 0],
    [0, q * dt2, 0, q * dt],
  ];

  // Predict
  const P = state.P as Mat4;
  const xP = [
    state.x + state.vx * dt,
    state.y + state.vy * dt,
    state.vx,
    state.vy,
  ];
  const PP = mat4add(mat4mul(mat4mul(F, P), mat4transpose(F)), Q);

  // R diagonal
  const Rmat = [[R.sigmaLonM ** 2, 0], [0, R.sigmaLatM ** 2]];

  // S = H·P·Hᵀ + R (2×2)
  const HPHt = [
    [PP[0][0], PP[0][1]],
    [PP[1][0], PP[1][1]],
  ];
  const S = [[HPHt[0][0] + Rmat[0][0], HPHt[0][1]], [HPHt[1][0], HPHt[1][1] + Rmat[1][1]]];

  // S⁻¹ (2×2 аналитически)
  const det = S[0][0] * S[1][1] - S[0][1] * S[1][0];
  const Sinv = det !== 0
    ? [[S[1][1] / det, -S[0][1] / det], [-S[1][0] / det, S[0][0] / det]]
    : [[1 / S[0][0], 0], [0, 1 / S[1][1]]];

  // K = P·Hᵀ·S⁻¹ (4×2)
  const PHt = PP.map(row => [row[0], row[1]]);
  const K = PHt.map(row => [
    row[0] * Sinv[0][0] + row[1] * Sinv[1][0],
    row[0] * Sinv[0][1] + row[1] * Sinv[1][1],
  ]);

  // Innovation
  const y0 = obsX - xP[0];
  const y1 = obsY - xP[1];

  // Correct state
  const newState = [
    xP[0] + K[0][0] * y0 + K[0][1] * y1,
    xP[1] + K[1][0] * y0 + K[1][1] * y1,
    xP[2] + K[2][0] * y0 + K[2][1] * y1,
    xP[3] + K[3][0] * y0 + K[3][1] * y1,
  ];

  // Correct P: (I - KH)·P
  const I = mat4identity();
  const KH: Mat4 = mat4zero();
  for (let i = 0; i < 4; i++) {
    KH[i][0] = K[i][0];
    KH[i][1] = K[i][1];
  }
  const IminusKH = I.map((row, i) => row.map((v, j) => v - KH[i][j]));
  const newP = mat4mul(IminusKH, PP);

  return {
    x: newState[0],
    y: newState[1],
    vx: newState[2],
    vy: newState[3],
    P: newP,
  };
}

/**
 * Инициализирует начальное состояние Kalman для первой ноды трека.
 *
 * Позиционная и скоростная неопределённости задаются раздельно: смешивать их
 * нельзя — позиция в метрах (км-масштаб), скорость в м/с. Если для скорости
 * взять позиционную sigma, σ_v раздувается до км/с и эллипс становится гигантским.
 *
 * @param initialSigmaM           σ позиции (м), из точности геопривязки.
 * @param initialVelocitySigmaMps σ скорости (м/с), из профиля кинематики.
 */
export function kalmanInitState(
  lat: number,
  lon: number,
  refLat: number,
  refLon: number,
  initialSigmaM: number,
  initialVelocitySigmaMps: number,
): KalmanStateJson {
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((refLat * Math.PI) / 180);
  const x = (lon - refLon) * metersPerDegLon;
  const y = (lat - refLat) * metersPerDegLat;
  const posVar = initialSigmaM ** 2;
  const velVar = initialVelocitySigmaMps ** 2;

  return {
    x,
    y,
    vx: 0,
    vy: 0,
    P: [
      [posVar, 0, 0, 0],
      [0, posVar, 0, 0],
      [0, 0, velVar, 0],
      [0, 0, 0, velVar],
    ],
  };
}
