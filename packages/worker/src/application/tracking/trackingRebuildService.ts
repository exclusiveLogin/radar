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
  checkTrackTermination,
  haversineDistanceM,
  kalmanStep,
  kalmanInitState,
  observationCovarianceMeters,
  scaleObservationCovariance,
  innovationGate,
  buildTrackMetadata,
  canEnterAttention,
  resolveAssignments,
  DEFAULT_SEED_MIN,
  DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  DEFAULT_SEED_WEIGHTS,
  canSeedCandidate,
  segmentVelocityMps as computeSegmentVelocityMps,
  type SeedWeights,
  type ProfileKinematics,
  type TrackingCandidate,
  type TrackingDomainNode as TrajectoryNode,
  type TrackingDomainTrack as TrajectoryTrack,
  type ThreatProfile,
  type TrackingWatermark,
  type TrackingPipelineConfig,
  type TrackingRebuildStats,
  type MutationState,
  type TrackAttentionTarget,
  type AssignStats,
} from "@radar/shared";
import {
  loadTrackingCandidates,
  loadTrackingCandidatesBatch,
  countTrackingCandidates,
  countTrackingCandidateStats,
  markPipelineCandidatesConsumed,
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

  // 1. Загружаем все кандидаты за период (full rebuild — без consumed guard)
  const allCandidates = await loadTrackingCandidates(ds, { since, until, excludeConsumed: false });

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

  const openTracks = await loadOpenTracksFromDb(ds, rebuildAt, opts.config);
  const byProfile = groupByProfile(opts.candidates);
  let collapsedByDedup = 0;
  let stdbscanClusters = 0;
  let kalmanTracksOpen = 0;
  let kalmanTracksClosed = 0;
  let kalmanNodesAdded = 0;
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
    stdbscanClusters += deduplicated.length;

    opts.onProgress?.({
      stage: "stdbscan",
      stdbscanClusters,
      stdbscanCollapsed: collapsedByDedup,
    });

    opts.onProgress?.({ stage: "kalman" });
    const profileOpen = openTracks.filter(t => t.profile === profile && !t.closed);
    const seedMin = opts.config?.seedMin ?? DEFAULT_SEED_MIN;
    const seedMaxFrontKm = opts.config?.seedMaxFrontDistanceKm ?? DEFAULT_SEED_MAX_FRONT_DISTANCE_KM;
    const seedWeights = resolveSeedWeights(opts.config);
    const profileBuilt = buildTracksForProfile(
      deduplicated,
      profileOpen,
      rebuildAt,
      kin,
      seedMin,
      seedMaxFrontKm,
      seedWeights,
    );
    built.tracks.push(...profileBuilt.tracks);
    built.nodes.push(...profileBuilt.nodes);
    kalmanTracksOpen += profileBuilt.tracks.filter(t => t.status === "active").length;
    kalmanTracksClosed += profileBuilt.tracks.filter(t => t.status === "closed").length;
    kalmanNodesAdded += profileBuilt.nodes.length;

    opts.onProgress?.({
      stage: "kalman",
      stdbscanClusters,
      stdbscanCollapsed: collapsedByDedup,
      kalmanTracksOpen,
      kalmanTracksClosed,
      kalmanNodesAdded,
    });
  }

  opts.onProgress?.({
    stage: "persisting",
    stdbscanClusters,
    stdbscanCollapsed: collapsedByDedup,
    kalmanTracksOpen,
    kalmanTracksClosed,
    kalmanNodesAdded,
  });
  if (built.tracks.length > 0 || built.nodes.length > 0) {
    await persistTracks(ds, built, opts.rebuildGen);
  }

  await markPipelineCandidatesConsumed(
    ds,
    opts.candidates.map(c => c.eventLocationId),
  );

  const watermark = computeWatermark(opts.candidates);
  opts.onProgress?.({
    stage: "done",
    stdbscanClusters,
    stdbscanCollapsed: collapsedByDedup,
    kalmanTracksOpen,
    kalmanTracksClosed,
    kalmanNodesAdded,
  });

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
  countTrackingPipelineRemaining,
  countTrackingCandidateStats,
  markPipelineCandidatesConsumed,
} from "./loadTrackingCandidates.js";
export { maxEpsilonTemporalMs };

/** Макс. окно «продолжения» недавно закрытого трека (staleAfterMs по профилям). */
function maxStaleWindowMs(config?: TrackingPipelineConfig): number {
  const overrides = config?.profiles;
  return Math.max(
    ...(Object.keys(PROFILE_KINEMATICS) as ThreatProfile[]).map(p =>
      resolveProfileKinematics(p, overrides).staleAfterMs,
    ),
  );
}

/**
 * Загружает треки, к которым можно прилинковать новые точки:
 * active + недавно closed/stale (в пределах staleAfterMs) — иначе каждый burst даёт 2-нодовую цепочку.
 */
async function loadOpenTracksFromDb(
  ds: DataSource,
  rebuildAt: Date,
  config?: TrackingPipelineConfig,
): Promise<MutableTrack[]> {
  const continuableSince = new Date(rebuildAt.getTime() - maxStaleWindowMs(config));

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
     FROM trajectory_tracks
     WHERE status = 'active'
        OR (status IN ('closed', 'stale') AND last_at >= $1)`,
    [continuableSince.toISOString()],
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
        mutationState: { phase: "stable", consecutiveSoftAssigns: 0 },
      };
      return track;
    })
    .filter((t): t is MutableTrack => t !== null);
}

/**
 * SSOT in-memory assign-движок (Kalman): seed/link/intercept без БД.
 * Используется и продовым rebuild, и offline-тюнером — единая физика линковки,
 * поэтому chi2/processNoise/rear реально влияют на результат.
 */
/** Веса географии seed из конфига пайплайна (фолбэк — дефолты домена). */
function resolveSeedWeights(config?: TrackingPipelineConfig): SeedWeights {
  return {
    regionFront: config?.seedRegionFront ?? DEFAULT_SEED_WEIGHTS.regionFront,
    regionInteriorRf: config?.seedRegionInteriorRf ?? DEFAULT_SEED_WEIGHTS.regionInteriorRf,
    frontProximityD0Km: config?.seedFrontProximityD0Km ?? DEFAULT_SEED_WEIGHTS.frontProximityD0Km,
  };
}

export function buildMutableTracks(
  candidates: TrackingCandidate[],
  kin: ProfileKinematics,
  rebuildAt: Date,
  seedMin = DEFAULT_SEED_MIN,
  seedMaxFrontKm = DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  seedOpen: MutableTrack[] = [],
  seedWeights: SeedWeights = DEFAULT_SEED_WEIGHTS,
): MutableTrack[] {
  const openTracks = [...seedOpen];
  const closedTracks: MutableTrack[] = [];
  assignBatch(candidates, openTracks, closedTracks, kin, rebuildAt, seedMin, seedMaxFrontKm, seedWeights);
  return [...openTracks, ...closedTracks];
}

function buildTracksForProfile(
  candidates: TrackingCandidate[],
  seedOpen: MutableTrack[],
  rebuildAt: Date,
  kin: ProfileKinematics,
  seedMin = DEFAULT_SEED_MIN,
  seedMaxFrontKm = DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  seedWeights: SeedWeights = DEFAULT_SEED_WEIGHTS,
): BuiltTracks {
  return finalizeMutableTracks(
    buildMutableTracks(candidates, kin, rebuildAt, seedMin, seedMaxFrontKm, seedOpen, seedWeights),
    rebuildAt,
  );
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

export type MutableTrack = {
  id: string;
  nodes: TrajectoryNode[];
  profile: ThreatProfile;
  totalDistanceM: number;
  refLat: number;
  refLon: number;
  closed: boolean;
  mutationState: MutationState;
};

/** Attention assign batch — Phase A/B/C через resolveAssignments. */
function assignBatch(
  candidates: TrackingCandidate[],
  openTracks: MutableTrack[],
  closedTracks: MutableTrack[],
  kin: ProfileKinematics,
  rebuildAt: Date,
  seedMin: number,
  seedMaxFrontKm: number,
  seedWeights: SeedWeights = DEFAULT_SEED_WEIGHTS,
): AssignStats {
  const consumed = new Set<string>();
  const stats: AssignStats = {
    links: 0,
    softLinks: 0,
    seeds: 0,
    intercepts: 0,
    skips: 0,
    attentionConflicts: 0,
  };

  for (const candidate of candidates) {
    if (!canEnterAttention(candidate)) continue;

    const targets = openTracks
      .filter(t => !t.closed)
      .map(t => toAttentionTarget(t));

    const { decisions, stats: stepStats } = resolveAssignments(
      [candidate],
      targets,
      kin,
      { consumed, seedMin, seedMaxFrontDistanceKm: seedMaxFrontKm, seedWeights },
    );

    stats.links += stepStats.links;
    stats.softLinks += stepStats.softLinks;
    stats.seeds += stepStats.seeds;
    stats.intercepts += stepStats.intercepts;
    stats.skips += stepStats.skips;
    stats.attentionConflicts += stepStats.attentionConflicts;

    const decision = decisions[0];
    if (!decision) continue;

    switch (decision.kind) {
      case "link": {
        const track = openTracks.find(t => t.id === decision.trackId);
        if (!track) break;
        appendNode(track, candidate, kin, rebuildAt, decision.soft);
        updateMutationState(track, decision.soft, candidate);
        maybeCloseTrack(track, candidate, kin, openTracks, closedTracks, false);
        break;
      }
      case "seed":
        openTracks.push(startTrack(candidate, kin));
        break;
      case "intercept": {
        const track = openTracks.find(t => t.id === decision.trackId);
        if (!track) break;
        appendNode(track, candidate, kin, rebuildAt, false);
        maybeCloseTrack(track, candidate, kin, openTracks, closedTracks, true);
        break;
      }
      case "skip":
        break;
    }
  }

  return stats;
}

function toAttentionTarget(track: MutableTrack): TrackAttentionTarget {
  const last = track.nodes[track.nodes.length - 1]!;
  const prev = track.nodes.length >= 2 ? track.nodes[track.nodes.length - 2]! : null;
  const segmentVel = prev
    ? computeSegmentVelocityMps(
        prev.lat,
        prev.lon,
        last.lat,
        last.lon,
        (last.occurredAt.getTime() - prev.occurredAt.getTime()) / 1000,
      )
    : null;

  return {
    trackId: track.id,
    profile: track.profile,
    lastAt: last.occurredAt,
    lastLat: last.lat,
    lastLon: last.lon,
    kalmanState: last.kalmanState,
    refLat: track.refLat,
    refLon: track.refLon,
    mutationState: track.mutationState,
    segmentVelocityMps: segmentVel,
  };
}

function updateMutationState(
  track: MutableTrack,
  soft: boolean,
  candidate: TrackingCandidate,
): void {
  if (soft) {
    track.mutationState = {
      phase: "expanded",
      consecutiveSoftAssigns: track.mutationState.consecutiveSoftAssigns + 1,
    };
    return;
  }
  if (candidate.mode === "correct") {
    track.mutationState = { phase: "stable", consecutiveSoftAssigns: 0 };
  }
}

function maybeCloseTrack(
  track: MutableTrack,
  candidate: TrackingCandidate,
  kin: ProfileKinematics,
  openTracks: MutableTrack[],
  closedTracks: MutableTrack[],
  forceIntercept: boolean,
): void {
  const term = checkTrackTermination({
    firstAt: track.nodes[0]!.occurredAt,
    currentAt: candidate.occurredAt,
    totalDistanceM: track.totalDistanceM,
    profile: kin,
    forceIntercept,
  });
  if (!term.shouldClose) return;
  track.closed = true;
  closedTracks.push(track);
  const idx = openTracks.indexOf(track);
  if (idx >= 0) openTracks.splice(idx, 1);
}

/** Строит треки из дедуплицированных кандидатов через attention assign. */
function buildTracks(candidates: TrackingCandidate[], rebuildAt: Date): BuiltTracks {
  const openTracks: MutableTrack[] = [];
  const closedTracks: MutableTrack[] = [];

  const byProfile = groupByProfile(candidates.filter(canEnterAttention));
  for (const profile of Object.keys(byProfile) as ThreatProfile[]) {
    const kin = PROFILE_KINEMATICS[profile];
    assignBatch(byProfile[profile]!, openTracks, closedTracks, kin, rebuildAt, DEFAULT_SEED_MIN, DEFAULT_SEED_MAX_FRONT_DISTANCE_KM);
  }

  return finalizeMutableTracks([...openTracks, ...closedTracks], rebuildAt);
}

/** Добавляет ноду к треку с Kalman-шагом. */
function appendNode(
  track: MutableTrack,
  candidate: TrackingCandidate,
  kin: ProfileKinematics,
  _rebuildAt: Date,
  soft = false,
): void {
  const lastNode = track.nodes[track.nodes.length - 1]!;
  const dtSeconds = (candidate.occurredAt.getTime() - lastNode.occurredAt.getTime()) / 1000;
  const R = scaleObservationCovariance(
    observationCovarianceMeters(candidate.precision, candidate.trust),
    kin.observationSigmaScale,
  );

  let kalmanState = lastNode.kalmanState;
  const noiseScale = soft ? kin.processNoiseScale * 4 : kin.processNoiseScale;

  if (candidate.mode === "correct" && kalmanState) {
    const gate = innovationGate({
      state: kalmanState,
      observationLat: candidate.lat,
      observationLon: candidate.lon,
      observedAt: candidate.occurredAt,
      R,
      refLat: track.refLat,
      refLon: track.refLon,
      maxVelocityMs: kin.maxVelocityMs,
      chi2Threshold: kin.chi2Threshold,
      rearThresholdM: kin.rearThresholdM,
      processNoiseScale: noiseScale,
      dtSeconds,
    });

    if (gate.accept || soft) {
      kalmanState = kalmanStep(
        kalmanState,
        candidate.lat,
        candidate.lon,
        dtSeconds,
        R,
        noiseScale,
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
    mutationState: { phase: "stable", consecutiveSoftAssigns: 0 },
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
