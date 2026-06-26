/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Матрица наблюдений R (2×2) для Kalman — sigma от точности геолокации и trust.
 *          Чем точнее геопривязка и доверие к каналу, тем меньше R (больше вес наблюдения).
 * ---
 */

/**
 * Базовые sigma (м) по уровням точности геолокации.
 *
 * ВАЖНО: координаты мест из OSINT — это ЦЕНТРОИДЫ (города/НП), а не точка удара.
 * σ должна отражать радиус неопределённости «где внутри объекта», иначе Kalman
 * переоценивает доверие к центроиду и любой реальный переход выглядит выбросом.
 *  - coords / locality_with_coords — реально точная привязка (улица/объект).
 *  - city — центроид агломерации: σ ≈ полу-радиус города (несколько км), не 800м.
 */
const PRECISION_SIGMA_M: Record<string, number> = {
  coords: 300,
  locality_with_coords: 300,
  city: 5_000,
  locality: 3_000,
  settlement: 3_000,
  vicinity: 5_000,
  district: 8_000,
  region: 50_000,
  attribute: 15_000,
  unknown: 15_000,
};

const DEFAULT_SIGMA_M = 15_000;

export type ObservationCovariance = {
  /** Sigma по широте (м). */
  sigmaLatM: number;
  /** Sigma по долготе (м). */
  sigmaLonM: number;
};

/**
 * Вычисляет матрицу наблюдений R (диагональ) по точности и доверию.
 *
 * Effective sigma = base_sigma / sqrt(trust).
 * trust ∈ [0..1]; при trust=0 используем 0.01 чтобы избежать деления на ноль.
 */
export function observationCovarianceMeters(
  precision: string,
  trust: number,
): ObservationCovariance {
  const base = PRECISION_SIGMA_M[precision] ?? DEFAULT_SIGMA_M;
  const effectiveTrust = Math.max(trust, 0.01);
  const sigma = base / Math.sqrt(effectiveTrust);
  return { sigmaLatM: sigma, sigmaLonM: sigma };
}

/** Масштабирует R под OSINT-разброс (множитель из ProfileKinematics). */
export function scaleObservationCovariance(
  R: ObservationCovariance,
  scale: number,
): ObservationCovariance {
  if (scale === 1) return R;
  return {
    sigmaLatM: R.sigmaLatM * scale,
    sigmaLonM: R.sigmaLonM * scale,
  };
}
