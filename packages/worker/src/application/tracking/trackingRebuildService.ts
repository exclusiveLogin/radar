/**
 * ---
 * layer: worker/application
 * domain: tracking
 * purpose: Оркестратор rebuild L1-треков.
 *          Фаза 1: full rebuild (truncate + insert, идемпотентен).
 *
 *          Пайплайн:
 *          loadCandidates → stdbscanDedup (per-profile) → originGate
 *          → Kalman pipeline → terminationGate → persist tracks + nodes
 * ---
 */
import type { DataSource } from "typeorm";
import {
  PROFILE_KINEMATICS,
  resolveProfileKinematics,
  maxEpsilonTemporalMs,
  stdbscanDedup,
  scoreSeedCandidate,
  isNearAnyOpenTrack,
  checkTrackTermination,
  haversineDistanceM,
  kalmanStep,
  kalmanInitState,
  observationCovarianceMeters,
  scaleObservationCovariance,
  innovationGate,
  buildTrackMetadata,
  type ProfileKinematics,
  type TrackingCandidate,
  type TrackingDomainNode as TrajectoryNode,
  type TrackingDomainTrack as TrajectoryTrack,
  type ThreatProfile,
  type TrackingWatermark,
  type TrackingPipelineConfig,
  type TrackingRebuildStats,
} from "@radar/shared";
import {
  loadTrackingCandidates,
  loadTrackingCandidatesBatch,
  countTrackingCandidates,
  countTrackingCandidateStats,
} from "./loadTrackingCandidates.js";
import { randomUUID } from "crypto";

type RebuildOptions = {
  since: Date;
  until: Date;
  rebuildGen?: string;
  /** false — dry-run, не сохраняет. */
  persist?: boolean;
};

type RebuildResult = {
  tracksCount: number;
  nodesCount: number;
  collapsedByDedup: number;
  elapsedMs: number;
};

/**
 * Полный rebuild L1-треков за период [since, until].
 *
 * V1: полная перестройка (truncate + insert).
 * V2: инкрементальный rebuild с watermark.
 */
export async function runTrackingRebuild(
  ds: DataSource,
  opts: RebuildOptions,
): Promise<RebuildResult> {
  const startMs = Date.now();
  const { since, until, persist = true } = opts;
  const rebuildGen = opts.rebuildGen ?? randomUUID();

  // 1. Загружаем все кандидаты за период (ORDER BY occurred_at ASC)
  const allCandidates = await loadTrackingCandidates(ds, { since, until });

  // 2. Разбиваем по профилю угрозы для независимого DBSCAN dedup
  const byProfile = groupByProfile(allCandidates);
  const allDeduped: TrackingCandidate[] = [];
  let collapsedByDedup = 0;

  for (const [profile, candidates] of Object.entries(byProfile)) {
    const kin = PROFILE_KINEMATICS[profile as ThreatProfile];
    const { deduplicated, collapsedCount } = stdbscanDedup(candidates, {
      epsilonSpatialM: kin.stdbscanEpsilonSpatialM,
      epsilonTemporalMs: kin.stdbscanEpsilonTemporalMs,
      minPts: kin.stdbscanMinPts,
    });
    allDeduped.push(...deduplicated);
    collapsedByDedup += collapsedCount;
  }

  // Сортируем все дедуплицированные по времени для Kalman
  allDeduped.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  // 3. Kalman pipeline: строим треки
  const builtTracks = buildTracks(allDeduped, until);

  // 4. Сохраняем в БД
  if (persist && builtTracks.tracks.length > 0) {
    await persistTracks(ds, builtTracks, rebuildGen);
  }

  return {
    tracksCount: builtTracks.tracks.length,
    nodesCount: builtTracks.nodes.length,
    collapsedByDedup,
    elapsedMs: Date.now() - startMs,
  };
}

export type IncrementalBatchResult = {
  tracksCount: number;
  nodesCount: number;
  collapsedByDedup: number;
  watermark: TrackingWatermark | null;
};

export type IncrementalBatchOptions = {
  candidates: TrackingCandidate[];
  rebuildGen: string;
  rebuildAt?: Date;
  config?: TrackingPipelineConfig;
  onProgress?: (stats: Partial<TrackingRebuildStats>) => void;
};

/** Инкрементальный батч: per-profile ST-DBSCAN + Kalman + UPSERT. */
export async function runIncrementalBatch(
  ds: DataSource,
  opts: IncrementalBatchOptions,
): Promise<IncrementalBatchResult> {
  const rebuildAt = opts.rebuildAt ?? new Date();
  const profileOverrides = opts.config?.profiles;
  opts.onProgress?.({ stage: "loading" });

  const openTracks = await loadOpenTracksFromDb(ds);
  const byProfile = groupByProfile(opts.candidates);
  let collapsedByDedup = 0;
  const built: BuiltTracks = { tracks: [], nodes: [] };

  for (const profile of Object.keys(byProfile) as ThreatProfile[]) {
    const kin = resolveProfileKinematics(profile, profileOverrides);
    opts.onProgress?.({ stage: "stdbscan" });
    const { deduplicated, collapsedCount } = stdbscanDedup(byProfile[profile]!, {
      epsilonSpatialM: kin.stdbscanEpsilonSpatialM,
      epsilonTemporalMs: kin.stdbscanEpsilonTemporalMs,
      minPts: kin.stdbscanMinPts,
    });
    collapsedByDedup += collapsedCount;

    opts.onProgress?.({ stage: "kalman" });
    const profileOpen = openTracks.filter(t => t.profile === profile && !t.closed);
    const profileBuilt = buildTracksForProfile(deduplicated, profileOpen, rebuildAt, kin);
    built.tracks.push(...profileBuilt.tracks);
    built.nodes.push(...profileBuilt.nodes);
  }

  opts.onProgress?.({ stage: "persisting" });
  if (built.tracks.length > 0 || built.nodes.length > 0) {
    await persistTracks(ds, built, opts.rebuildGen);
  }

  const watermark = computeWatermark(opts.candidates);
  opts.onProgress?.({ stage: "done" });

  return {
    tracksCount: built.tracks.length,
    nodesCount: built.nodes.length,
    collapsedByDedup,
    watermark,
  };
}

export {
  loadTrackingCandidatesBatch,
  countTrackingCandidates,
  countTrackingCandidateStats,
} from "./loadTrackingCandidates.js";
export { maxEpsilonTemporalMs };

async function loadOpenTracksFromDb(ds: DataSource): Promise<MutableTrack[]> {
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
     FROM trajectory_tracks WHERE status = 'active'`,
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
     FROM trajectory_nodes WHERE track_id IN (${ids}) ORDER BY track_id, seq`,
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
    .map(row => {
      const nodes = nodesByTrack.get(row.id) ?? [];
      if (nodes.length === 0) return null;
      const first = nodes[0]!;
      const track: MutableTrack = {
        id: row.id,
        nodes,
        profile: row.threat_profile as ThreatProfile,
        totalDistanceM: row.total_distance_m,
        refLat: first.lat,
        refLon: first.lon,
        closed: false,
      };
      return track;
    })
    .filter((t): t is MutableTrack => t !== null);
}

function buildTracksForProfile(
  candidates: TrackingCandidate[],
  seedOpen: MutableTrack[],
  rebuildAt: Date,
  kin: ProfileKinematics,
): BuiltTracks {
  const openTracks = [...seedOpen];
  const closedTracks: MutableTrack[] = [];

  for (const candidate of candidates) {
    const linkedTrack = tryLink(candidate, openTracks, kin);
    if (linkedTrack) {
      appendNode(linkedTrack, candidate, kin, rebuildAt);
      const term = checkTrackTermination({
        firstAt: linkedTrack.nodes[0].occurredAt,
        currentAt: candidate.occurredAt,
        totalDistanceM: linkedTrack.totalDistanceM,
        profile: kin,
      });
      if (term.shouldClose) {
        linkedTrack.closed = true;
        closedTracks.push(linkedTrack);
        openTracks.splice(openTracks.indexOf(linkedTrack), 1);
      }
      continue;
    }

    const openSummaries = openTracks
      .filter(t => t.profile === candidate.threatProfile)
      .map(t => {
        const last = t.nodes[t.nodes.length - 1]!;
        return { lastLat: last.lat, lastLon: last.lon, lastAt: last.occurredAt, profile: t.profile };
      });

    if (isNearAnyOpenTrack(candidate, openSummaries, kin)) continue;
    openTracks.push(startTrack(candidate, kin));
  }

  return finalizeMutableTracks([...openTracks, ...closedTracks], rebuildAt);
}

function finalizeMutableTracks(allMutable: MutableTrack[], rebuildAt: Date): BuiltTracks {
  const tracks: TrajectoryTrack[] = [];
  const nodes: TrajectoryNode[] = [];

  for (const mt of allMutable) {
    if (mt.nodes.length < 2) continue;
    const kin = PROFILE_KINEMATICS[mt.profile];
    const meta = buildTrackMetadata(mt.nodes, kin, rebuildAt);
    tracks.push({
      id: mt.id,
      status: mt.closed ? "closed" : meta.status,
      threatProfile: mt.profile,
      firstAt: meta.firstAt,
      lastAt: meta.lastAt,
      lastLat: meta.lastLat,
      lastLon: meta.lastLon,
      velocityMs: meta.velocityMs,
      bearingDeg: meta.bearingDeg,
      nodeCount: meta.nodeCount,
      totalDistanceM: mt.totalDistanceM,
    });
    nodes.push(...mt.nodes.map((n, i) => ({ ...n, seq: i })));
  }

  return { tracks, nodes };
}

function computeWatermark(candidates: TrackingCandidate[]): TrackingWatermark | null {
  if (candidates.length === 0) return null;
  const last = candidates[candidates.length - 1]!;
  return {
    lastOccurredAt: last.occurredAt.toISOString(),
    lastEventLocationId: last.eventLocationId,
  };
}

type BuiltTracks = {
  tracks: TrajectoryTrack[];
  nodes: TrajectoryNode[];
};

type MutableTrack = {
  id: string;
  nodes: TrajectoryNode[];
  profile: ThreatProfile;
  totalDistanceM: number;
  refLat: number;
  refLon: number;
  closed: boolean;
};

/** Строит треки из дедуплицированных кандидатов через Kalman. */
function buildTracks(candidates: TrackingCandidate[], rebuildAt: Date): BuiltTracks {
  const openTracks: MutableTrack[] = [];
  const closedTracks: MutableTrack[] = [];

  for (const candidate of candidates) {
    const kin = PROFILE_KINEMATICS[candidate.threatProfile];

    // Пробуем прилинковать к открытому треку того же профиля
    const linkedTrack = tryLink(candidate, openTracks, kin);

    if (linkedTrack) {
      appendNode(linkedTrack, candidate, kin, rebuildAt);
      // Проверяем termination после добавления
      const term = checkTrackTermination({
        firstAt: linkedTrack.nodes[0].occurredAt,
        currentAt: candidate.occurredAt,
        totalDistanceM: linkedTrack.totalDistanceM,
        profile: kin,
      });
      if (term.shouldClose) {
        linkedTrack.closed = true;
        closedTracks.push(linkedTrack);
        openTracks.splice(openTracks.indexOf(linkedTrack), 1);
      }
    } else {
      // Проверяем origin gate — можно ли стартовать новый трек
      const openSummaries = openTracks
        .filter(t => t.profile === candidate.threatProfile)
        .map(t => {
          const last = t.nodes[t.nodes.length - 1];
          return { lastLat: last.lat, lastLon: last.lon, lastAt: last.occurredAt, profile: t.profile };
        });

      const tooCloseToExisting = isNearAnyOpenTrack(candidate, openSummaries, kin);
      if (tooCloseToExisting) continue; // не стартуем новый, не линкуем

      // Стартуем новый трек
      const newTrack = startTrack(candidate, kin);
      openTracks.push(newTrack);
    }
  }

  // Все оставшиеся open tracks → финализируем
  const allMutable = [...openTracks, ...closedTracks];
  const tracks: TrajectoryTrack[] = [];
  const nodes: TrajectoryNode[] = [];

  for (const mt of allMutable) {
    if (mt.nodes.length < 2) continue; // минимум 2 ноды для трека

    const kin = PROFILE_KINEMATICS[mt.profile];
    const meta = buildTrackMetadata(mt.nodes, kin, rebuildAt);

    tracks.push({
      id: mt.id,
      status: mt.closed ? "closed" : meta.status,
      threatProfile: mt.profile,
      firstAt: meta.firstAt,
      lastAt: meta.lastAt,
      lastLat: meta.lastLat,
      lastLon: meta.lastLon,
      velocityMs: meta.velocityMs,
      bearingDeg: meta.bearingDeg,
      nodeCount: meta.nodeCount,
      totalDistanceM: mt.totalDistanceM,
    });

    nodes.push(...mt.nodes.map((n, i) => ({ ...n, seq: i })));
  }

  return { tracks, nodes };
}

/** Находит открытый трек, к которому можно прилинковать кандидата. */
function tryLink(
  candidate: TrackingCandidate,
  openTracks: MutableTrack[],
  kin: ProfileKinematics,
): MutableTrack | null {
  let best: MutableTrack | null = null;
  let bestDist = Infinity;

  for (const track of openTracks) {
    if (track.profile !== candidate.threatProfile) continue;
    if (track.closed) continue;

    const lastNode = track.nodes[track.nodes.length - 1];
    const gapMs = candidate.occurredAt.getTime() - lastNode.occurredAt.getTime();

    if (gapMs < 0 || gapMs > kin.maxGapMs) continue;

    const dist = haversineDistanceM(candidate.lat, candidate.lon, lastNode.lat, lastNode.lon);
    if (dist > kin.maxLinkDistanceM) continue;

    if (dist < bestDist) {
      bestDist = dist;
      best = track;
    }
  }

  return best;
}

/** Добавляет ноду к треку с Kalman-шагом. */
function appendNode(
  track: MutableTrack,
  candidate: TrackingCandidate,
  kin: ProfileKinematics,
  _rebuildAt: Date,
): void {
  const lastNode = track.nodes[track.nodes.length - 1];
  const dtSeconds = (candidate.occurredAt.getTime() - lastNode.occurredAt.getTime()) / 1000;
  const R = scaleObservationCovariance(
    observationCovarianceMeters(candidate.precision, candidate.trust),
    kin.observationSigmaScale,
  );

  let kalmanState = lastNode.kalmanState;

  if (candidate.mode === "correct" && kalmanState) {
    const gate = innovationGate({
      state: kalmanState,
      observationLat: candidate.lat,
      observationLon: candidate.lon,
      observedAt: candidate.occurredAt,
      R,
      maxVelocityMs: kin.maxVelocityMs,
      chi2Threshold: kin.chi2Threshold,
      rearThresholdM: kin.rearThresholdM,
    });

    if (gate.accept) {
      kalmanState = kalmanStep(
        kalmanState,
        candidate.lat,
        candidate.lon,
        dtSeconds,
        R,
        kin.processNoiseScale,
        track.refLat,
        track.refLon,
      );
    }
  }

  const distFromLast = haversineDistanceM(candidate.lat, candidate.lon, lastNode.lat, lastNode.lon);
  track.totalDistanceM += distFromLast;

  const node: TrajectoryNode = {
    id: randomUUID(),
    trackId: track.id,
    seq: track.nodes.length,
    occurredAt: candidate.occurredAt,
    lat: candidate.lat,
    lon: candidate.lon,
    placeId: candidate.placeId,
    mode: candidate.mode,
    kalmanState,
    sourceRefs: candidate.sourceRefs,
  };

  track.nodes.push(node);
}

/** Стартует новый трек из seed-кандидата. */
function startTrack(seed: TrackingCandidate, kin: ProfileKinematics): MutableTrack {
  const { sigmaLatM } = scaleObservationCovariance(
    observationCovarianceMeters(seed.precision, seed.trust),
    kin.observationSigmaScale,
  );
  const kalmanState = seed.mode === "correct"
    ? kalmanInitState(seed.lat, seed.lon, seed.lat, seed.lon, sigmaLatM)
    : null;

  const firstNode: TrajectoryNode = {
    id: randomUUID(),
    trackId: "",
    seq: 0,
    occurredAt: seed.occurredAt,
    lat: seed.lat,
    lon: seed.lon,
    placeId: seed.placeId,
    mode: seed.mode,
    kalmanState,
    sourceRefs: seed.sourceRefs,
  };

  const trackId = randomUUID();
  firstNode.trackId = trackId;

  return {
    id: trackId,
    nodes: [firstNode],
    profile: seed.threatProfile,
    totalDistanceM: 0,
    refLat: seed.lat,
    refLon: seed.lon,
    closed: false,
  };
}

/** Группирует кандидатов по профилю угрозы для независимого DBSCAN dedup. */
function groupByProfile(
  candidates: TrackingCandidate[],
): Record<ThreatProfile, TrackingCandidate[]> {
  return candidates.reduce(
    (acc, c) => {
      (acc[c.threatProfile] ??= []).push(c);
      return acc;
    },
    {} as Record<ThreatProfile, TrackingCandidate[]>,
  );
}

/** Сохраняет треки и ноды в БД (V1 full rebuild: truncate + insert). */
async function persistTracks(
  ds: DataSource,
  built: BuiltTracks,
  rebuildGen: string,
): Promise<void> {
  await ds.transaction(async (em) => {
    await em.query(
      `DELETE FROM trajectory_nodes WHERE track_id IN (SELECT id FROM trajectory_tracks WHERE rebuild_gen != $1)`,
      [rebuildGen],
    );
    await em.query(`DELETE FROM trajectory_tracks WHERE rebuild_gen != $1`, [rebuildGen]);

    if (built.tracks.length > 0) {
      const trackRows = built.tracks.map(t =>
        `('${t.id}','${t.status}','${t.threatProfile}','${t.firstAt.toISOString()}','${t.lastAt.toISOString()}',` +
        `${t.lastLat},${t.lastLon},${t.velocityMs ?? "NULL"},${t.bearingDeg ?? "NULL"},` +
        `${t.nodeCount},${t.totalDistanceM},'${rebuildGen}')`
      ).join(",");

      await em.query(
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
      // Batch insert нод чанками по 1000
      const chunkSize = 1000;
      for (let i = 0; i < built.nodes.length; i += chunkSize) {
        const chunk = built.nodes.slice(i, i + chunkSize);
        const nodeRows = chunk.map(n =>
          `('${n.id}','${n.trackId}',${n.seq},'${n.occurredAt.toISOString()}',` +
          `${n.lat},${n.lon},${n.placeId ? `'${n.placeId}'` : "NULL"},'${n.mode}',` +
          `${n.kalmanState ? `'${JSON.stringify(n.kalmanState)}'::jsonb` : "NULL"},` +
          `'${JSON.stringify(n.sourceRefs)}'::jsonb)`
        ).join(",");

        await em.query(
          `INSERT INTO trajectory_nodes
           (id, track_id, seq, occurred_at, lat, lon, place_id, mode, kalman_state, source_refs)
           VALUES ${nodeRows}
           ON CONFLICT (id) DO NOTHING`,
        );
      }
    }
  });
}
