import type { TracksFlowResponse, TracksListResponse } from "@radar/shared";

type TrackFeature = {
  type: "Feature";
  geometry:
    | { type: "LineString"; coordinates: [number, number][] }
    | { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string>;
};

export type TracksGeoJsonCollection = {
  type: "FeatureCollection";
  features: TrackFeature[];
};

/** Пустая коллекция — начальное состояние source. */
export function emptyTracksFeatureCollection(): TracksGeoJsonCollection {
  return { type: "FeatureCollection", features: [] };
}

/**
 * L1 треки → GeoJSON для MapLibre (линии + origin-точки в одном source).
 * Ноды сортируются по seq; без нод — только точка lastLon/lastLat.
 */
export function tracksListToGeoJson(
  response: TracksListResponse | null,
  options?: { showSegmentOnlyDrafts?: boolean },
): TracksGeoJsonCollection {
  if (!response?.tracks.length) return emptyTracksFeatureCollection();

  const showSegmentOnlyDrafts = options?.showSegmentOnlyDrafts ?? false;
  const features: TrackFeature[] = [];

  for (const track of response.tracks) {
    const nodes = [...(track.nodes ?? [])].sort((a, b) => a.seq - b.seq);
    let hasMovement = false;

    if (nodes.length >= 2) {
      const coordinates = nodes.map((n) => [n.lon, n.lat] as [number, number]);
      const [firstLon, firstLat] = coordinates[0]!;
      hasMovement = coordinates.some(
        ([lon, lat], i) => i > 0 && (lon !== firstLon || lat !== firstLat),
      );
      const isSegmentOnly = nodes.every(n => n.mode === "segment_only");
      if (hasMovement && !isSegmentOnly) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: {
            kind: "track-line",
            trackId: track.id,
            threatProfile: track.threatProfile,
            status: track.status,
            mode: "correct",
          },
        });
      } else if (hasMovement && isSegmentOnly && showSegmentOnlyDrafts) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: {
            kind: "track-line",
            trackId: track.id,
            threatProfile: track.threatProfile,
            status: track.status,
            mode: "segment_only",
          },
        });
      }
    }

    const origin = nodes[0] ?? { lon: track.lastLon, lat: track.lastLat };
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [origin.lon, origin.lat] },
      properties: {
        kind: "track-origin",
        trackId: track.id,
        threatProfile: track.threatProfile,
        status: track.status,
        nodeCount: String(track.nodeCount),
        stationary: nodes.length >= 2 && !hasMovement ? "true" : "false",
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/** L2 flow уже GeoJSON — нормализуем null в пустую коллекцию. */
export function tracksFlowToGeoJson(
  response: TracksFlowResponse | null,
): TracksFlowResponse | TracksGeoJsonCollection {
  return response ?? emptyTracksFeatureCollection();
}
