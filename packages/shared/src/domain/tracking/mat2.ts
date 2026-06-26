/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Операции 2×2 для Mahalanobis и innovation covariance.
 * ---
 */

export type Mat2 = [[number, number], [number, number]];

/** Аналитический inverse 2×2. */
export function invert2x2(S: Mat2): Mat2 {
  const det = S[0][0] * S[1][1] - S[0][1] * S[1][0];
  if (Math.abs(det) < 1e-12) {
    return [
      [1 / (S[0][0] || 1), 0],
      [0, 1 / (S[1][1] || 1)],
    ];
  }
  return [
    [S[1][1] / det, -S[0][1] / det],
    [-S[1][0] / det, S[0][0] / det],
  ];
}

/** Mahalanobis²: innovᵀ S⁻¹ innov */
export function mahalanobis2(innov: [number, number], S: Mat2): number {
  const Sinv = invert2x2(S);
  const x = innov[0];
  const y = innov[1];
  return (
    x * (Sinv[0][0] * x + Sinv[0][1] * y) + y * (Sinv[1][0] * x + Sinv[1][1] * y)
  );
}
