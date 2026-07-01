/**
 * GeoJSON локусов ассоциации: у КАЖДОЙ ноды — зона χ² (S = H·P·Hᵀ + R),
 * по которой gate принимал СЛЕДУЮЩУЮ точку. dt = реальный gap между нодами,
 * потолок полуоси = maxLinkDistanceM (геометрический предел линковки).
 * Подсветка in/out: попала ли следующая точка внутрь локуса.
 */
import {
  PROFILE_KINEMATICS,
  kalmanLocusEllipseRing,
  observationCovarianceMeters,
  type TracksListResponse,
} from "@radar/shared";

/** Проверка «точка внутри кольца» (ray casting). */
function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Оценка dt для terminal-локуcа: берём последний реальный шаг, но не выходим за maxGap. */
function estimateTerminalDtSeconds(
  nodes: TracksListResponse["tracks"][number]["nodes"],
  kinMaxGapMs: number,
): number {
  if (!nodes || nodes.length < 2) return Math.max(1, kinMaxGapMs / 1000);
  const last = nodes[nodes.length - 1];
  const prev = nodes[nodes.length - 2];
  const raw = (new Date(last.occurredAt).getTime() - new Date(prev.occurredAt).getTime()) / 1000;
  const clamped = Math.min(Math.max(1, raw), kinMaxGapMs / 1000);
  return Number.isFinite(clamped) ? clamped : Math.max(1, kinMaxGapMs / 1000);
}

/** Локальный фолбэк для debug-визуализации, когда state не сохранён в ноде. */
function createFallbackKalmanState(sigmaPosM: number) {
  const sigma2 = Math.max(1, sigmaPosM * sigmaPosM);
  const velSigma2 = Math.max(1, sigma2 / 4);
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    P: [
      [sigma2, 0, 0, 0],
      [0, sigma2, 0, 0],
      [0, 0, velSigma2, 0],
      [0, 0, 0, velSigma2],
    ],
  };
}

export function tracksLocusDebugToGeoJson(
  response: TracksListResponse | null,
  options?: { trackId?: string | null },
): GeoJSON.FeatureCollection {
  if (!response?.tracks.length) {
    return { type: "FeatureCollection", features: [] };
  }

  const trackIdFilter = options?.trackId ?? null;
  if (!trackIdFilter) {
    return { type: "FeatureCollection", features: [] };
  }

  const features: GeoJSON.Feature[] = [];

  for (const track of response.tracks) {
    if (track.id !== trackIdFilter) continue;
    const nodes = track.nodes;
    const refLat = track.refLat;
    const refLon = track.refLon;
    if (!nodes || nodes.length < 2 || refLat == null || refLon == null) continue;

    const profile = track.threatProfile ?? "uav";
    const kin = PROFILE_KINEMATICS[profile] ?? PROFILE_KINEMATICS.uav;
    const Rbase = observationCovarianceMeters("city", 0.7);
    const R = {
      sigmaLatM: Rbase.sigmaLatM * kin.observationSigmaScale,
      sigmaLonM: Rbase.sigmaLonM * kin.observationSigmaScale,
    };

    // Локус у ноды i — зона ожидания следующей ноды.
    // Для последней ноды строим terminal-локус с прогнозным dt (диагностика остановки).
    const terminalDtSeconds = estimateTerminalDtSeconds(nodes, kin.maxGapMs);
    for (let i = 0; i < nodes.length; i++) {
      const cur = nodes[i];
      const next = nodes[i + 1];
      // Показываем локус для каждой ноды (кроме последней), даже если kalmanState
      // в ноде отсутствует: используем локальный фолбэк-стейт от самой точки.
      const state =
        cur.kalmanState ??
        createFallbackKalmanState(R.sigmaLatM);

      const dtSeconds = next
        ? Math.max(
            1,
            (new Date(next.occurredAt).getTime() - new Date(cur.occurredAt).getTime()) / 1000,
          )
        : terminalDtSeconds;

      const ring = kalmanLocusEllipseRing({
        state,
        refLat,
        refLon,
        dtSeconds,
        R,
        processNoiseScale: kin.processNoiseScale,
        chi2Threshold: kin.chi2Threshold,
        anisotropyRatio: kin.locusAnisotropyRatio,
        maxSemiAxisM: kin.maxLinkDistanceM,
      });
      if (!ring) continue;

      const inLocus = next ? pointInRing(next.lon, next.lat, ring) : undefined;
      const baseProps = {
        trackId: track.id,
        seq: cur.seq,
        dtSeconds: Math.round(dtSeconds),
        terminal: next == null,
      };
      const props = inLocus == null ? baseProps : { ...baseProps, inLocus };
      const fillKind =
        inLocus == null
          ? "kalman-locus-fill-terminal"
          : inLocus
            ? "kalman-locus-fill"
            : "kalman-locus-fill-out";
      const outlineKind =
        inLocus == null
          ? "kalman-locus-outline-terminal"
          : inLocus
            ? "kalman-locus-outline"
            : "kalman-locus-outline-out";

      features.push({
        type: "Feature",
        properties: { ...props, kind: fillKind },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
      features.push({
        type: "Feature",
        properties: { ...props, kind: outlineKind },
        geometry: { type: "LineString", coordinates: ring },
      });
    }
  }

  return { type: "FeatureCollection", features };
}
