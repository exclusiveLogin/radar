/**
 * ---
 * layer: api/map
 * domain: tracking
 * purpose: Read-side сервис треков — запросы L1 (треки) и L2 (flow-коридоры).
 *          V1: on-read rollup сегментов; L2 вычисляется из nodes без кеша.
 * ---
 */
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { pgTimestampToIso } from "../infrastructure/persistence/typeorm-query-rows";
import { TrackingL1ResetGate } from "../tracking/tracking-l1-reset.gate";
import {
  buildTrackEdges,
  rollupSegmentCounts,
  filterEdgesByAsOf,
  filterNodesByAsOf,
  zoneKeyForCandidate,
  type TracksListQuery,
  type TracksListResponse,
  type TrajectoryTrack,
  type TracksFlowQuery,
  type TracksFlowResponse,
  type TracksGravityQuery,
  type TracksGravityResponse,
  type TrajectoryNode,
  type NodeMode,
  type ThreatProfile,
  type TrackingDomainNode,
  type SegmentRollup,
} from "@radar/shared";

type NodeRow = {
  id: string;
  track_id: string;
  seq: number;
  occurred_at: Date | string;
  lat: number;
  lon: number;
  place_id: string | null;
  mode: string;
  kalman_state: unknown;
  source_refs: unknown;
};

type TrackRow = {
  id: string;
  status: string;
  threat_profile: string;
  first_at: Date | string;
  last_at: Date | string;
  last_lat: number;
  last_lon: number;
  velocity_ms: number | null;
  bearing_deg: number | null;
  node_count: number;
  total_distance_m: number;
  ref_lat: number | null;
  ref_lon: number | null;
  head_kalman_state: unknown;
};

@Injectable()
export class MapTracksService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly l1ResetGate: TrackingL1ResetGate,
  ) {}

  /** Список треков с опциональным включением нод. */
  async listTracks(query: TracksListQuery): Promise<TracksListResponse> {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    if (this.l1ResetGate.isPaused()) {
      return { tracks: [], meta: { asOf: asOf.toISOString(), count: 0 } };
    }

    const conditions: string[] = ["t.last_at <= $1"];
    const params: unknown[] = [asOf.toISOString()];
    let idx = 2;

    if (query.since) {
      conditions.push(`t.first_at >= $${idx++}`);
      params.push(query.since);
    }
    if (query.status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(query.status);
    }
    if (query.threatProfile) {
      conditions.push(`t.threat_profile = $${idx++}`);
      params.push(query.threatProfile);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const trackRows = await this.ds.query<TrackRow[]>(
      `SELECT t.id, t.status, t.threat_profile, t.first_at, t.last_at, t.last_lat, t.last_lon,
              t.velocity_ms, t.bearing_deg, t.node_count, t.total_distance_m,
              fn.lat AS ref_lat, fn.lon AS ref_lon, ln.kalman_state AS head_kalman_state
       FROM mat_track t
       LEFT JOIN LATERAL (
         SELECT lat, lon
         FROM mat_track_node
         WHERE track_id = t.id
         ORDER BY seq ASC
         LIMIT 1
       ) fn ON true
       LEFT JOIN LATERAL (
         SELECT kalman_state
         FROM mat_track_node
         WHERE track_id = t.id AND occurred_at <= $1
         ORDER BY seq DESC
         LIMIT 1
       ) ln ON true
       ${where}
       ORDER BY t.last_at DESC
       LIMIT $${idx}`,
      [...params, query.limit],
    );

    const tracks: TrajectoryTrack[] = trackRows.map(r => ({
      id: r.id,
      status: r.status as TrajectoryTrack["status"],
      threatProfile: r.threat_profile as ThreatProfile,
      firstAt: pgTimestampToIso(r.first_at),
      lastAt: pgTimestampToIso(r.last_at),
      lastLat: r.last_lat,
      lastLon: r.last_lon,
      velocityMs: r.velocity_ms,
      bearingDeg: r.bearing_deg,
      nodeCount: r.node_count,
      totalDistanceM: r.total_distance_m,
      refLat: r.ref_lat ?? undefined,
      refLon: r.ref_lon ?? undefined,
      headKalmanState: (r.head_kalman_state as TrajectoryTrack["headKalmanState"]) ?? undefined,
    }));

    if (query.includeNodes && tracks.length > 0) {
      const trackIds = tracks.map(t => `'${t.id}'`).join(",");
      const nodeRows = await this.ds.query<NodeRow[]>(
        `SELECT id, track_id, seq, occurred_at, lat, lon, place_id, mode, kalman_state, source_refs
         FROM mat_track_node
         WHERE track_id IN (${trackIds}) AND occurred_at <= $1
         ORDER BY track_id, seq`,
        [asOf.toISOString()],
      );

      const nodesByTrack = new Map<string, TrajectoryNode[]>();
      for (const r of nodeRows) {
        const node: TrajectoryNode = {
          id: r.id,
          seq: r.seq,
          occurredAt: pgTimestampToIso(r.occurred_at),
          lat: r.lat,
          lon: r.lon,
          placeId: r.place_id,
          mode: r.mode as NodeMode,
          kalmanState: (r.kalman_state as TrajectoryNode["kalmanState"]) ?? undefined,
          sourceRefs: (r.source_refs as TrajectoryNode["sourceRefs"]) ?? [],
        };
        const arr = nodesByTrack.get(r.track_id) ?? [];
        arr.push(node);
        nodesByTrack.set(r.track_id, arr);
      }

      for (const track of tracks) {
        track.nodes = nodesByTrack.get(track.id) ?? [];
      }
    }

    return { tracks, meta: { asOf: asOf.toISOString(), count: tracks.length } };
  }

  /** Flow-коридоры (L2 rollup) — вычисляется on-read из нод. */
  async getTracksFlow(query: TracksFlowQuery): Promise<TracksFlowResponse> {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const minCount = query.minCount;
    if (this.l1ResetGate.isPaused()) {
      return {
        type: "FeatureCollection",
        features: [],
        meta: { asOf: asOf.toISOString(), count: 0, minCount },
      };
    }

    // Загружаем ноды в окне (включая nodes для rollup)
    const conditions: string[] = ["n.occurred_at <= $1"];
    const params: unknown[] = [asOf.toISOString()];
    let idx = 2;

    if (query.since) {
      conditions.push(`n.occurred_at >= $${idx++}`);
      params.push(query.since);
    }
    if (query.threatProfile) {
      conditions.push(`t.threat_profile = $${idx++}`);
      params.push(query.threatProfile);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const nodeRows = await this.ds.query<(NodeRow & { threat_profile: string })[]>(
      `SELECT n.id, n.track_id, n.seq, n.occurred_at, n.lat, n.lon, n.place_id, n.mode,
              n.kalman_state, n.source_refs, t.threat_profile
       FROM mat_track_node n
       JOIN mat_track t ON t.id = n.track_id
       ${where}
       ORDER BY n.track_id, n.seq
       LIMIT $${idx}`,
      [...params, query.limit * 100],
    );

    // Группируем ноды по трекам
    const trackNodes = new Map<string, { nodes: TrackingDomainNode[]; profile: ThreatProfile }>();
    for (const r of nodeRows) {
      if (!trackNodes.has(r.track_id)) {
        trackNodes.set(r.track_id, { nodes: [], profile: r.threat_profile as ThreatProfile });
      }
      trackNodes.get(r.track_id)!.nodes.push({
        id: r.id,
        trackId: r.track_id,
        seq: r.seq,
        occurredAt: new Date(r.occurred_at),
        lat: r.lat,
        lon: r.lon,
        placeId: r.place_id,
        mode: r.mode as NodeMode,
        kalmanState: r.kalman_state as TrackingDomainNode["kalmanState"],
        sourceRefs: (r.source_refs as TrackingDomainNode["sourceRefs"]) ?? [],
      });
    }

    // Строим рёбра из каждого трека
    const allEdges = [...trackNodes.entries()].flatMap(([trackId, { nodes, profile }]) => {
      const filtered = filterNodesByAsOf(nodes, asOf);
      return buildTrackEdges(filtered, trackId, profile);
    });

    const filteredEdges = filterEdgesByAsOf(allEdges, asOf);
    const rollup = rollupSegmentCounts(filteredEdges, {
      minCount,
      splitByProfile: query.splitByProfile,
    });

    const maxWeight = rollup[0]?.weight ?? 1;
    const features = rollup.slice(0, query.limit).map((seg: SegmentRollup) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [seg.fromLon, seg.fromLat] as [number, number],
          [seg.toLon, seg.toLat] as [number, number],
        ],
      },
      properties: {
        fromPlaceKey: seg.fromPlaceKey,
        toPlaceKey: seg.toPlaceKey,
        count: seg.count,
        weight: seg.weight,
        normalizedWeight: seg.weight / maxWeight,
        threatProfile: seg.threatProfile,
        lastSeenAt: seg.lastSeenAt.toISOString(),
      },
    }));

    return {
      type: "FeatureCollection",
      features,
      meta: {
        asOf: asOf.toISOString(),
        count: features.length,
        minCount,
      },
    };
  }

  /** Gravity heatmap — агрегация узлов треков по зонам (place_id | geohash). */
  async getTracksGravity(query: TracksGravityQuery): Promise<TracksGravityResponse> {
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    if (this.l1ResetGate.isPaused()) {
      return { type: "FeatureCollection", features: [], asOf: asOf.toISOString() };
    }
    const precision = query.geohashPrecision;

    const conditions: string[] = ["n.occurred_at <= $1"];
    const params: unknown[] = [asOf.toISOString()];
    let idx = 2;

    if (query.since) {
      conditions.push(`n.occurred_at >= $${idx++}`);
      params.push(query.since);
    }
    if (query.threatProfile) {
      conditions.push(`t.threat_profile = $${idx++}`);
      params.push(query.threatProfile);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const nodeRows = await this.ds.query<
      { lat: number; lon: number; place_id: string | null }[]
    >(
      `SELECT n.lat, n.lon, n.place_id
       FROM mat_track_node n
       JOIN mat_track t ON t.id = n.track_id
       ${where}`,
      params,
    );

    const buckets = new Map<string, { mass: number; lat: number; lon: number }>();
    for (const r of nodeRows) {
      const zoneKey = zoneKeyForCandidate(r.place_id, r.lat, r.lon, precision);
      const prev = buckets.get(zoneKey);
      if (prev) {
        prev.mass += 1;
        continue;
      }
      buckets.set(zoneKey, { mass: 1, lat: r.lat, lon: r.lon });
    }

    const features = [...buckets.entries()].map(([zoneKey, b]) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [b.lon, b.lat] as [number, number],
      },
      properties: { zoneKey, mass: b.mass },
    }));

    return {
      type: "FeatureCollection",
      features,
      asOf: asOf.toISOString(),
    };
  }
}
