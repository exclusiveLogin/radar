/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Legacy r_доп(dt) — не используется для gate; локус = Kalman χ² (kalmanLocus.ts).
 * ---
 */

/** Радиус допустимого маневра за паузу dt (м). */
export function maneuverToleranceM(
  maxVelocityMs: number,
  dtSeconds: number,
  sigmaPosM: number,
): number {
  const dt = Math.max(0, dtSeconds);
  return Math.max(maxVelocityMs * dt + sigmaPosM, 1);
}

/** Нормированный «грех» попадания: 1 = на границе локуса. */
export function sinCoefficientRho(distM: number, toleranceM: number): number {
  const tol = Math.max(toleranceM, 1);
  return distM / tol;
}

/** Точка в локусе манёвра. */
export function inManeuverLocus(rho: number): boolean {
  return rho <= 1;
}

/** σ позиции из диагонали R (м). */
export function sigmaPosFromObservation(sigmaLatM: number, sigmaLonM: number): number {
  return Math.max(sigmaLatM, sigmaLonM, 1);
}
