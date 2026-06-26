import type { ThreatProfile, TracksListResponse } from "@radar/shared";

/** Фиксированное «временное окно» анимации (deck.gl float32). Все треки бегут 0…WINDOW за один цикл. */
export const TRIPS_ANIM_WINDOW = 1_000;

/** Один путь для Deck.gl TripsLayer. */
export type TrackTrip = {
  trackId: string;
  threatProfile: ThreatProfile;
  path: [number, number][];
  timestamps: number[];
};

export type TracksTripsPayload = {
  trips: TrackTrip[];
};

const EMPTY_PAYLOAD: TracksTripsPayload = { trips: [] };

/**
 * L1 треки → формат TripsLayer.
 * Timestamps нормализованы от t0 трека (float32-safe для deck.gl).
 */
export function tracksListToTripsData(
  response: TracksListResponse | null,
): TracksTripsPayload {
  if (!response?.tracks.length) return EMPTY_PAYLOAD;

  const trips: TrackTrip[] = [];

  for (const track of response.tracks) {
    const nodes = [...(track.nodes ?? [])].sort((a, b) => a.seq - b.seq);
    if (nodes.length < 2) continue;

    const coordinates = nodes.map((n) => [n.lon, n.lat] as [number, number]);
    const [firstLon, firstLat] = coordinates[0]!;
    const hasMovement = coordinates.some(
      ([lon, lat], i) => i > 0 && (lon !== firstLon || lat !== firstLat),
    );
    if (!hasMovement) continue;

    const t0 = Date.parse(nodes[0]!.occurredAt);
    const rawTimestamps = nodes.map((n) => Math.fround(Date.parse(n.occurredAt) - t0));
    const rawDuration = rawTimestamps[rawTimestamps.length - 1] ?? 0;
    if (rawDuration <= 0) continue;

    // Нормализуем в фиксированное окно — каждый трек проходит весь путь за один цикл анимации.
    const timestamps =
      rawDuration > 0
        ? rawTimestamps.map((t) => Math.fround((t / rawDuration) * TRIPS_ANIM_WINDOW))
        : rawTimestamps.map((_, i) =>
            Math.fround((i / Math.max(1, nodes.length - 1)) * TRIPS_ANIM_WINDOW),
          );

    trips.push({
      trackId: track.id,
      threatProfile: track.threatProfile,
      path: coordinates,
      timestamps,
    });
  }

  return { trips };
}
