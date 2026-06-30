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

export function tracksLocusDebugToGeoJson(
  response: TracksListResponse | null,
): GeoJSON.FeatureCollection {
  if (!response?.tracks.length) {
    return { type: "FeatureCollection", features: [] };
  }

  const features: GeoJSON.Feature[] = [];

  for (const track of response.tracks) {
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

    // Локус у ноды i — зона ожидания ноды i+1 (с реальным dt между ними).
    for (let i = 0; i < nodes.length - 1; i++) {
      const cur = nodes[i];
      const next = nodes[i + 1];
      const state = cur.kalmanState;
      if (!state) continue;

      const dtSeconds = Math.max(
        1,
        (new Date(next.occurredAt).getTime() - new Date(cur.occurredAt).getTime()) / 1000,
      );

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

      const inLocus = pointInRing(next.lon, next.lat, ring);
      const props = {
        trackId: track.id,
        seq: cur.seq,
        dtSeconds: Math.round(dtSeconds),
        inLocus,
      };

      features.push({
        type: "Feature",
        properties: { ...props, kind: inLocus ? "kalman-locus-fill" : "kalman-locus-fill-out" },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
      features.push({
        type: "Feature",
        properties: { ...props, kind: inLocus ? "kalman-locus-outline" : "kalman-locus-outline-out" },
        geometry: { type: "LineString", coordinates: ring },
      });
    }
  }

  return { type: "FeatureCollection", features };
}
