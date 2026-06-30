import type { ThreatProfile, TracksListResponse } from "@radar/shared";

/** Фиксированное «временное окно» прохода одного трека (deck.gl float32). */
export const TRIPS_ANIM_WINDOW = 1_000;

/**
 * Разброс старта между треками: фаза каждого трека ∈ [0, SPREAD) добавляется к
 * timestamps, чтобы точки стартовали вразнобой (не синхронно).
 */
export const TRIPS_PHASE_SPREAD = TRIPS_ANIM_WINDOW;

/** Полное окно цикла = проход трека + разброс фаз. */
export const TRIPS_LOOP_WINDOW = TRIPS_ANIM_WINDOW + TRIPS_PHASE_SPREAD;

/** Детерминированный хэш строки → [0, 1). Стабилен между refetch (без дёрганья). */
function hashUnit(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

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
    if (nodes.every(n => n.mode === "segment_only")) continue;

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

    // Фаза старта трека — детерминированно по trackId, чтобы точки бежали вразнобой.
    const phase = hashUnit(track.id) * TRIPS_PHASE_SPREAD;

    // Нормализуем путь в окно прохода и сдвигаем на фазу (staggered start).
    const timestamps =
      rawDuration > 0
        ? rawTimestamps.map((t) => Math.fround(phase + (t / rawDuration) * TRIPS_ANIM_WINDOW))
        : rawTimestamps.map((_, i) =>
            Math.fround(phase + (i / Math.max(1, nodes.length - 1)) * TRIPS_ANIM_WINDOW),
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
