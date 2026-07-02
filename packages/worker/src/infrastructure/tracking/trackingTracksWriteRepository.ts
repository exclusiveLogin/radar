/**
 * ---
 * layer: worker/infrastructure
 * domain: tracking
 * purpose: SQL write-порт треков/нод — persist артефактов join-фазы.
 * ---
 */
import type { DataSource } from "typeorm";
import {
  withTrackingL1Transaction,
  type TrackingPgQueryFn,
  type TrackingDomainNode as TrajectoryNode,
  type TrackingDomainTrack as TrajectoryTrack,
} from "@radar/shared";

export type BuiltTracks = {
  tracks: TrajectoryTrack[];
  nodes: TrajectoryNode[];
};

/** Сохраняет треки и ноды в БД (внутри уже открытой L1 xact, lock снаружи). */
export async function writeTracksL1(
  query: TrackingPgQueryFn,
  built: BuiltTracks,
  rebuildGen: string,
  options?: { pruneByRebuildGen?: boolean },
): Promise<void> {
  if (options?.pruneByRebuildGen ?? true) {
    await query(
      `DELETE FROM trajectory_nodes WHERE track_id IN (SELECT id FROM trajectory_tracks WHERE rebuild_gen != $1)`,
      [rebuildGen],
    );
    await query(`DELETE FROM trajectory_tracks WHERE rebuild_gen != $1`, [rebuildGen]);
  }

  if (built.tracks.length > 0) {
    const trackRows = built.tracks.map(t =>
      `('${t.id}','${t.status}','${t.threatProfile}','${t.firstAt.toISOString()}','${t.lastAt.toISOString()}',` +
      `${t.lastLat},${t.lastLon},${t.velocityMs ?? "NULL"},${t.bearingDeg ?? "NULL"},` +
      `${t.nodeCount},${t.totalDistanceM},'${rebuildGen}')`
    ).join(",");

    await query(
      `INSERT INTO trajectory_tracks
       (id, status, threat_profile, first_at, last_at, last_lat, last_lon,
        velocity_ms, bearing_deg, node_count, total_distance_m, rebuild_gen)
       VALUES ${trackRows}
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         last_at = EXCLUDED.last_at,
         last_lat = EXCLUDED.last_lat,
         last_lon = EXCLUDED.last_lon,
         velocity_ms = EXCLUDED.velocity_ms,
         bearing_deg = EXCLUDED.bearing_deg,
         node_count = EXCLUDED.node_count,
         total_distance_m = EXCLUDED.total_distance_m,
         rebuild_gen = EXCLUDED.rebuild_gen`,
    );
  }

  if (built.nodes.length > 0) {
    const chunkSize = 1000;
    for (let i = 0; i < built.nodes.length; i += chunkSize) {
      const chunk = built.nodes.slice(i, i + chunkSize);
      const nodeRows = chunk.map(n =>
        `('${n.id}','${n.trackId}',${n.seq},'${n.occurredAt.toISOString()}',` +
        `${n.lat},${n.lon},${n.placeId ? `'${n.placeId}'` : "NULL"},'${n.mode}',` +
        `${n.kalmanState ? `'${JSON.stringify(n.kalmanState)}'::jsonb` : "NULL"},` +
        `'${JSON.stringify(n.sourceRefs)}'::jsonb)`
      ).join(",");

      await query(
        `INSERT INTO trajectory_nodes
         (id, track_id, seq, occurred_at, lat, lon, place_id, mode, kalman_state, source_refs)
         VALUES ${nodeRows}
         ON CONFLICT (id) DO NOTHING`,
      );
    }
  }
}

/** Сохраняет треки и ноды в БД в собственной L1-транзакции. */
export async function writeTracks(
  ds: DataSource,
  built: BuiltTracks,
  rebuildGen: string,
  options?: { pruneByRebuildGen?: boolean },
): Promise<void> {
  await withTrackingL1Transaction(
    fn => ds.transaction(async em => fn((sql, params) => em.query(sql, params))),
    query => writeTracksL1(query, built, rebuildGen, options),
  );
}
