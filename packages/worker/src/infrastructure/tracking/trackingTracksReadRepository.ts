/**
 * ---
 * layer: worker/infrastructure
 * domain: tracking
 * purpose: SQL read-порт открытых треков — вход join-фазы tracking pipeline.
 * ---
 */
import type { DataSource } from "typeorm";
import {
  PROFILE_KINEMATICS,
  resolveProfileKinematics,
  type NextGenSeedTrack,
  type ThreatProfile,
  type TrackingPipelineConfig,
  type TrackingDomainNode as TrajectoryNode,
} from "@radar/shared";

export type TrackingOpenTrackSeed = NextGenSeedTrack & { profile: ThreatProfile };

/**
 * Окно continuation: не меньше maxGapMs профиля, иначе as-of seeds режут линки,
 * которые Step3 обязан рассматривать.
 */
function seedWindowMs(config?: TrackingPipelineConfig): number {
  const overrides = config?.profiles;
  return Math.max(
    ...(Object.keys(PROFILE_KINEMATICS) as ThreatProfile[]).map(p =>
      resolveProfileKinematics(p, overrides).maxGapMs,
    ),
  );
}

/**
 * Треки, к которым можно прилинковать новые точки по event-time срезу.
 * asOf — время среза (не wall-clock): last_at ∈ [asOf - seedWindow, asOf].
 * Status не участвует — иначе retracking истории всегда видит пустой seed pool.
 */
export async function loadOpenTrackSeeds(
  ds: DataSource,
  asOf: Date,
  config?: TrackingPipelineConfig,
): Promise<TrackingOpenTrackSeed[]> {
  const windowMs = seedWindowMs(config);
  const since = new Date(asOf.getTime() - windowMs);

  const trackRows = await ds.query<
    {
      id: string;
      threat_profile: string;
      total_distance_m: number;
      last_lat: number;
      last_lon: number;
    }[]
  >(
    `SELECT id, threat_profile, total_distance_m, last_lat, last_lon
     FROM mat_track
     WHERE last_at <= $1
       AND last_at >= $2`,
    [asOf.toISOString(), since.toISOString()],
  );
  if (trackRows.length === 0) return [];

  const ids = trackRows.map(r => `'${r.id}'`).join(",");
  const nodeRows = await ds.query<
    {
      id: string;
      track_id: string;
      seq: number;
      occurred_at: string;
      lat: number;
      lon: number;
      place_id: string | null;
      mode: string;
      kalman_state: unknown;
      source_refs: unknown;
    }[]
  >(
    `SELECT id, track_id, seq, occurred_at, lat, lon, place_id, mode, kalman_state, source_refs
     FROM mat_track_node WHERE track_id IN (${ids}) ORDER BY track_id, seq`,
  );

  const nodesByTrack = new Map<string, TrajectoryNode[]>();
  for (const r of nodeRows) {
    const node: TrajectoryNode = {
      id: r.id,
      trackId: r.track_id,
      seq: r.seq,
      occurredAt: new Date(r.occurred_at),
      lat: r.lat,
      lon: r.lon,
      placeId: r.place_id,
      mode: r.mode as TrajectoryNode["mode"],
      kalmanState: r.kalman_state as TrajectoryNode["kalmanState"],
      sourceRefs: (r.source_refs as TrajectoryNode["sourceRefs"]) ?? [],
    };
    const arr = nodesByTrack.get(r.track_id) ?? [];
    arr.push(node);
    nodesByTrack.set(r.track_id, arr);
  }

  return trackRows
    .map((row): TrackingOpenTrackSeed | null => {
      const nodes = nodesByTrack.get(row.id) ?? [];
      if (nodes.length === 0) return null;
      return {
        trackId: row.id,
        profile: row.threat_profile as ThreatProfile,
        nodes,
        refLat: nodes[0]!.lat,
        refLon: nodes[0]!.lon,
        totalDistanceM: row.total_distance_m,
      };
    })
    .filter((t): t is TrackingOpenTrackSeed => t !== null);
}
