/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: SSOT rear-front gate — отклонение наблюдений «позади» вектора движения.
 * ---
 */

/** Инновация (м) позади скорости (м/с) дальше rearThresholdM → backflow. */
export function isRearOfVelocity(
  innovXM: number,
  innovYM: number,
  vxMs: number,
  vyMs: number,
  rearThresholdM: number,
): boolean {
  const speed = Math.hypot(vxMs, vyMs);
  if (speed <= 0.1) return false;
  const dot = (innovXM * vxMs + innovYM * vyMs) / speed;
  return dot < -rearThresholdM;
}

/** Скорость последнего сегмента трека (м/с) в локальной проекции ref=конец сегмента. */
export function segmentVelocityMps(
  prevLat: number,
  prevLon: number,
  lastLat: number,
  lastLon: number,
  dtSeconds: number,
): [number, number] | null {
  if (dtSeconds <= 0) return null;
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos((lastLat * Math.PI) / 180);
  return [
    ((lastLon - prevLon) * metersPerDegLon) / dtSeconds,
    ((lastLat - prevLat) * metersPerDegLat) / dtSeconds,
  ];
}
