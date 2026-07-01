/**
 * ---
 * layer: worker/application
 * domain: tracking
 * purpose: Оркестратор rebuild L1-треков.
 *          Фаза 1: full rebuild (truncate + insert, идемпотентен).
 *
 *          Пайплайн:
 *          loadCandidates → clustering (collapse|magnet) → originGate
 *          → Kalman pipeline → terminationGate → persist tracks + nodes
 * ---
 */
import type { DataSource } from "typeorm";
import {
  PROFILE_KINEMATICS,
  resolveProfileKinematics,
  maxEpsilonTemporalMs,
  runClusteringForProfile,
  mergeMagnetismIndexes,
  resolveMagnetCostWeights,
  resolvePlaceGravityForRebuild,
  checkTrackTermination,
  haversineDistanceM,
  kalmanStep,
  kalmanInitState,
  observationCovarianceMeters,
  scaleObservationCovariance,
  innovationGate,
  buildTrackMetadata,
  canEnterAttention,
  resolveAssignmentsForAlgorithm,
  DEFAULT_SEED_MIN,
  DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  DEFAULT_SEED_WEIGHTS,
  DEFAULT_FLOW_ALIGNMENT,
  buildGreedyFlowChains,
  DEFAULT_GREEDY_FLOW,
  type GreedyFlowWeights,
  buildCorridorFromCandidates,
  temporalAssignSlices,
  EMPTY_CORRIDOR_ROLLUP_INDEX,
  canSeedCandidate,
  segmentVelocityMps as computeSegmentVelocityMps,
  type SeedWeights,
  type FlowAlignmentWeights,
  type AssociationAlgorithm,
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
  pickAssignableFromDedup,
  resolvePendingConsumedAfterDedup,
  resolvePendingConsumedAfterClustering,
  withTrackingL1Transaction,
  type TrackingPgQueryFn,
  type AssignStats,
  type AssignDecision,
  type CorridorRollupIndex,
  type MagnetismIndex,
} from "@radar/shared";
import {
  countTrackingPipelineRemaining,
  loadTrackingCandidates,
  loadDedupClosure,
  loadPendingTrackingCandidates,
  countTrackingCandidates,
  countTrackingCandidateStats,
  markPipelineCandidatesConsumed,
  markPipelineCandidatesConsumedTx,
  isTrackingPipelineEnabled,
} from "./loadTrackingCandidates.js";
import { NextGenOrchestrator, H3VectorFlowMap, type NextGenSeedTrack } from "@radar/shared";
import { randomUUID } from "crypto";

type RebuildOptions = {
  since: Date;
  until: Date;
  rebuildGen?: string;
  /** false — dry-run, не сохраняет. */
  persist?: boolean;
  /** Конфиг пайплайна: оверрайды кинематики, веса потока, flow gate. */
  config?: TrackingPipelineConfig;
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

  // 2. Кластеризация per-profile (collapse или magnet)
  const byProfile = groupByProfile(allCandidates);
  const allDeduped: TrackingCandidate[] = [];
  let collapsedByDedup = 0;
  const seedWeights = resolveSeedWeights(opts.config);
  const gravityIndex = resolvePlaceGravityForRebuild(allCandidates, opts.config, seedWeights);
  const magnetMaps: MagnetismIndex[] = [];

  for (const [profile, candidates] of Object.entries(byProfile)) {
    const result = runClusteringForProfile(
      candidates,
      profile as ThreatProfile,
      opts.config,
      seedWeights,
      gravityIndex,
      opts.config?.reuseAcrossTracks ?? false,
    );
    allDeduped.push(...result.candidates);
    collapsedByDedup += result.collapsedCount;
    if (result.magnetismIndex.size > 0) magnetMaps.push(result.magnetismIndex);
  }

  const magnetismIndex = mergeMagnetismIndexes(magnetMaps);

  // Сортируем все дедуплицированные по времени для Kalman
  allDeduped.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  // Phase W: frozen corridor из потока событий (до assign)
  const corridorIndex = buildCorridorFromCandidates(allDeduped, {
    profileOverrides: opts.config?.profiles,
  });

  // Phase A: Kalman + GNN assign на frozen weights
  const builtTracks = buildTracks(allDeduped, until, opts.config, magnetismIndex, corridorIndex);

  // 4. Сохраняем в БД
  if (persist && builtTracks.tracks.length > 0) {
    await persistTracks(ds, builtTracks, rebuildGen, {
      // Полная перестройка: L1 становится снимком текущего rebuild.
      pruneByRebuildGen: true,
    });
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
  consumedCount: number;
  watermark: TrackingWatermark | null;
};

export type IncrementalBatchOptions = {
  /** Pending-тик (chunk) — assign + consumed. */
  candidates: TrackingCandidate[];
  /** Глобальный dedup closure; по умолчанию = candidates. */
  dedupClosure?: TrackingCandidate[];
  /** Все pending в очереди (для consumed после глобального dedup). */
  fullPendingIds?: ReadonlySet<string>;
  rebuildGen: string;
  rebuildAt?: Date;
  config?: TrackingPipelineConfig;
  /** Run-scoped H3-поле NextGen: батчи прогона обогащают его, ребилд обнуляет. */
  flowField?: H3VectorFlowMap;
  onProgress?: (stats: Partial<TrackingRebuildStats>) => void | Promise<void>;
};

type NextGenPhase2Progress = {
  phase2PairsConsidered: number;
  phase2PairsAccepted: number;
  phase2PairsRejectedByKinematics: number;
  phase2ReliabilityAvg: number;
  phase2ReliabilityP95: number;
};

type NextGenPhase3Progress = {
  phase3LinksConsidered: number;
  phase3LinksAccepted: number;
  phase3NodesSeeded: number;
  phase3RejectGap: number;
  phase3RejectDistance: number;
  phase3RejectVelocity: number;
  phase3RejectCounterFlow: number;
  phase3RejectTurn: number;
  phase3RejectKalmanInnovation: number;
};

async function emitProgress(
  onProgress: IncrementalBatchOptions["onProgress"],
  stats: Partial<TrackingRebuildStats>,
): Promise<void> {
  await onProgress?.(stats);
}

/** Инкрементальный батч: per-profile ST-DBSCAN + Kalman + UPSERT. */
export async function runIncrementalBatch(
  ds: DataSource,
  opts: IncrementalBatchOptions,
): Promise<IncrementalBatchResult> {
  const rebuildAt = opts.rebuildAt ?? new Date();
  const profileOverrides = opts.config?.profiles;
  const chunkIds = new Set(opts.candidates.map(c => c.eventLocationId));
  const fullPendingIds =
    opts.fullPendingIds ?? chunkIds;
  const dedupClosure = opts.dedupClosure ?? opts.candidates;
  await emitProgress(opts.onProgress, { stage: "loading" });

  const openTracks = await loadOpenTracksFromDb(ds, rebuildAt, opts.config);
  const byProfile = groupByProfile(dedupClosure);
  let collapsedByDedup = 0;
  let stdbscanClusters = 0;
  let kalmanTracksOpen = 0;
  let kalmanTracksClosed = 0;
  let kalmanNodesAdded = 0;
  const nextGenPhase2Agg: NextGenPhase2Progress = {
    phase2PairsConsidered: 0,
    phase2PairsAccepted: 0,
    phase2PairsRejectedByKinematics: 0,
    phase2ReliabilityAvg: 0,
    phase2ReliabilityP95: 0,
  };
  const nextGenPhase3Agg: NextGenPhase3Progress = {
    phase3LinksConsidered: 0,
    phase3LinksAccepted: 0,
    phase3NodesSeeded: 0,
    phase3RejectGap: 0,
    phase3RejectDistance: 0,
    phase3RejectVelocity: 0,
    phase3RejectCounterFlow: 0,
    phase3RejectTurn: 0,
    phase3RejectKalmanInnovation: 0,
  };
  let nextGenProfilesWithAccepted = 0;
  const built: BuiltTracks = { tracks: [], nodes: [] };
  const dedupWinnerIds = new Set<string>();
  const handledIds = new Set<string>();

  const seedWeights = resolveSeedWeights(opts.config);
  const gravityIndex = resolvePlaceGravityForRebuild(dedupClosure, opts.config, seedWeights);
  const magnetMaps: MagnetismIndex[] = [];
  const isNextGen = opts.config?.associationAlgorithm === "nextgen-gravity";
  // NextGen не использует corridor rollup — не строим на каждом тике (дорого на closure).
  const corridorIndex = isNextGen
    ? EMPTY_CORRIDOR_ROLLUP_INDEX
    : buildCorridorFromCandidates(dedupClosure, {
        profileOverrides: opts.config?.profiles,
      });

  for (const profile of Object.keys(byProfile) as ThreatProfile[]) {
    await emitProgress(opts.onProgress, { stage: "stdbscan" });
    const result = runClusteringForProfile(
      byProfile[profile]!,
      profile,
      opts.config,
      seedWeights,
      gravityIndex,
      opts.config?.reuseAcrossTracks ?? false,
    );
    for (const id of result.winnerIds) dedupWinnerIds.add(id);
    collapsedByDedup += result.collapsedCount;
    stdbscanClusters += result.candidates.length;
    if (result.magnetismIndex.size > 0) magnetMaps.push(result.magnetismIndex);

    const toAssign = pickAssignableFromDedup(result.candidates, chunkIds);

    await emitProgress(opts.onProgress, {
      stage: "stdbscan",
      stdbscanClusters,
      stdbscanCollapsed: collapsedByDedup,
    });

    await emitProgress(opts.onProgress, { stage: "kalman" });
    const profileOpen = openTracks.filter(t => t.profile === profile && !t.closed);
    const seedMin = opts.config?.seedMin ?? DEFAULT_SEED_MIN;
    const seedMaxFrontKm = opts.config?.seedMaxFrontDistanceKm ?? DEFAULT_SEED_MAX_FRONT_DISTANCE_KM;
    const kin = resolveProfileKinematics(profile, profileOverrides);
    const magnetismIndex = mergeMagnetismIndexes(magnetMaps);
    const assoc = resolveAssociationRuntime(opts.config, magnetismIndex, corridorIndex);
    const profileBuilt = buildTracksForProfile(
      toAssign,
      profileOpen,
      rebuildAt,
      kin,
      seedMin,
      seedMaxFrontKm,
      assoc,
      opts.config,
      opts.flowField,
    );
    for (const id of profileBuilt.handledIds) handledIds.add(id);
    built.tracks.push(...profileBuilt.tracks);
    built.nodes.push(...profileBuilt.nodes);
    kalmanTracksOpen += profileBuilt.tracks.filter(t => t.status === "active").length;
    kalmanTracksClosed += profileBuilt.tracks.filter(t => t.status === "closed").length;
    kalmanNodesAdded += profileBuilt.nodes.length;
    if (profileBuilt.nextgenPhase2) {
      nextGenPhase2Agg.phase2PairsConsidered += profileBuilt.nextgenPhase2.phase2PairsConsidered;
      nextGenPhase2Agg.phase2PairsAccepted += profileBuilt.nextgenPhase2.phase2PairsAccepted;
      nextGenPhase2Agg.phase2PairsRejectedByKinematics += profileBuilt.nextgenPhase2.phase2PairsRejectedByKinematics;
      if (profileBuilt.nextgenPhase2.phase2PairsAccepted > 0) {
        nextGenProfilesWithAccepted += 1;
        nextGenPhase2Agg.phase2ReliabilityAvg += profileBuilt.nextgenPhase2.phase2ReliabilityAvg;
        nextGenPhase2Agg.phase2ReliabilityP95 += profileBuilt.nextgenPhase2.phase2ReliabilityP95;
      }
    }
    if (profileBuilt.nextgenPhase3) {
      nextGenPhase3Agg.phase3LinksConsidered += profileBuilt.nextgenPhase3.phase3LinksConsidered;
      nextGenPhase3Agg.phase3LinksAccepted += profileBuilt.nextgenPhase3.phase3LinksAccepted;
      nextGenPhase3Agg.phase3NodesSeeded += profileBuilt.nextgenPhase3.phase3NodesSeeded;
      nextGenPhase3Agg.phase3RejectGap += profileBuilt.nextgenPhase3.phase3RejectGap;
      nextGenPhase3Agg.phase3RejectDistance += profileBuilt.nextgenPhase3.phase3RejectDistance;
      nextGenPhase3Agg.phase3RejectVelocity += profileBuilt.nextgenPhase3.phase3RejectVelocity;
      nextGenPhase3Agg.phase3RejectCounterFlow += profileBuilt.nextgenPhase3.phase3RejectCounterFlow;
      nextGenPhase3Agg.phase3RejectTurn += profileBuilt.nextgenPhase3.phase3RejectTurn;
      nextGenPhase3Agg.phase3RejectKalmanInnovation += profileBuilt.nextgenPhase3.phase3RejectKalmanInnovation;
    }

    await emitProgress(opts.onProgress, {
      stage: "kalman",
      stdbscanClusters,
      stdbscanCollapsed: collapsedByDedup,
      kalmanTracksOpen,
      kalmanTracksClosed,
      kalmanNodesAdded,
      ...(nextGenPhase2Agg.phase2PairsConsidered > 0
        ? {
            phase2PairsConsidered: nextGenPhase2Agg.phase2PairsConsidered,
            phase2PairsAccepted: nextGenPhase2Agg.phase2PairsAccepted,
            phase2PairsRejectedByKinematics: nextGenPhase2Agg.phase2PairsRejectedByKinematics,
            phase2ReliabilityAvg: nextGenProfilesWithAccepted > 0
              ? nextGenPhase2Agg.phase2ReliabilityAvg / nextGenProfilesWithAccepted
              : 0,
            phase2ReliabilityP95: nextGenProfilesWithAccepted > 0
              ? nextGenPhase2Agg.phase2ReliabilityP95 / nextGenProfilesWithAccepted
              : 0,
          }
        : {}),
      ...(nextGenPhase3Agg.phase3LinksConsidered > 0
        ? {
            phase3LinksConsidered: nextGenPhase3Agg.phase3LinksConsidered,
            phase3LinksAccepted: nextGenPhase3Agg.phase3LinksAccepted,
            phase3NodesSeeded: nextGenPhase3Agg.phase3NodesSeeded,
            phase3RejectGap: nextGenPhase3Agg.phase3RejectGap,
            phase3RejectDistance: nextGenPhase3Agg.phase3RejectDistance,
            phase3RejectVelocity: nextGenPhase3Agg.phase3RejectVelocity,
            phase3RejectCounterFlow: nextGenPhase3Agg.phase3RejectCounterFlow,
            phase3RejectTurn: nextGenPhase3Agg.phase3RejectTurn,
            phase3RejectKalmanInnovation: nextGenPhase3Agg.phase3RejectKalmanInnovation,
          }
        : {}),
    });
  }

  await emitProgress(opts.onProgress, {
    stage: "persisting",
    stdbscanClusters,
    stdbscanCollapsed: collapsedByDedup,
    kalmanTracksOpen,
    kalmanTracksClosed,
    kalmanNodesAdded,
    ...(nextGenPhase2Agg.phase2PairsConsidered > 0
      ? {
          phase2PairsConsidered: nextGenPhase2Agg.phase2PairsConsidered,
          phase2PairsAccepted: nextGenPhase2Agg.phase2PairsAccepted,
          phase2PairsRejectedByKinematics: nextGenPhase2Agg.phase2PairsRejectedByKinematics,
          phase2ReliabilityAvg: nextGenProfilesWithAccepted > 0
            ? nextGenPhase2Agg.phase2ReliabilityAvg / nextGenProfilesWithAccepted
            : 0,
          phase2ReliabilityP95: nextGenProfilesWithAccepted > 0
            ? nextGenPhase2Agg.phase2ReliabilityP95 / nextGenProfilesWithAccepted
            : 0,
        }
      : {}),
    ...(nextGenPhase3Agg.phase3LinksConsidered > 0
      ? {
          phase3LinksConsidered: nextGenPhase3Agg.phase3LinksConsidered,
          phase3LinksAccepted: nextGenPhase3Agg.phase3LinksAccepted,
          phase3NodesSeeded: nextGenPhase3Agg.phase3NodesSeeded,
          phase3RejectGap: nextGenPhase3Agg.phase3RejectGap,
          phase3RejectDistance: nextGenPhase3Agg.phase3RejectDistance,
          phase3RejectVelocity: nextGenPhase3Agg.phase3RejectVelocity,
          phase3RejectCounterFlow: nextGenPhase3Agg.phase3RejectCounterFlow,
          phase3RejectTurn: nextGenPhase3Agg.phase3RejectTurn,
          phase3RejectKalmanInnovation: nextGenPhase3Agg.phase3RejectKalmanInnovation,
        }
      : {}),
  });

  // Точки текущего chunk всегда consumed после попытки assign — иначе winner без link
  // блокирует очередь на одном и том же срезе (залипание ~30% пайплайна).
  const consumedIds = resolvePendingConsumedAfterClustering(
    fullPendingIds,
    chunkIds,
    dedupWinnerIds,
    opts.config?.clusteringMode ?? "collapse",
    opts.config?.reuseAcrossTracks ?? false,
  ).filter(
    id => chunkIds.has(id) || !dedupWinnerIds.has(id) || handledIds.has(id),
  );

  let consumedCount = 0;
  if (await isTrackingPipelineEnabled(ds)) {
    await withTrackingL1Transaction(
      fn => ds.transaction(async em => fn((sql, params) => em.query(sql, params))),
      async query => {
        if (built.tracks.length > 0 || built.nodes.length > 0) {
          await persistTracksL1(query, built, opts.rebuildGen, { pruneByRebuildGen: false });
        }
        await markPipelineCandidatesConsumedTx(query, consumedIds);
      },
      { maxAttempts: 8, baseDelayMs: 150 },
    );
    consumedCount = consumedIds.length;
  }

  const watermark = consumedCount > 0 ? computeWatermark(opts.candidates) : null;
  await emitProgress(opts.onProgress, {
    stage: "idle",
    stdbscanClusters,
    stdbscanCollapsed: collapsedByDedup,
    kalmanTracksOpen,
    kalmanTracksClosed,
    kalmanNodesAdded,
    ...(nextGenPhase2Agg.phase2PairsConsidered > 0
      ? {
          phase2PairsConsidered: nextGenPhase2Agg.phase2PairsConsidered,
          phase2PairsAccepted: nextGenPhase2Agg.phase2PairsAccepted,
          phase2PairsRejectedByKinematics: nextGenPhase2Agg.phase2PairsRejectedByKinematics,
          phase2ReliabilityAvg: nextGenProfilesWithAccepted > 0
            ? nextGenPhase2Agg.phase2ReliabilityAvg / nextGenProfilesWithAccepted
            : 0,
          phase2ReliabilityP95: nextGenProfilesWithAccepted > 0
            ? nextGenPhase2Agg.phase2ReliabilityP95 / nextGenProfilesWithAccepted
            : 0,
        }
      : {}),
    ...(nextGenPhase3Agg.phase3LinksConsidered > 0
      ? {
          phase3LinksConsidered: nextGenPhase3Agg.phase3LinksConsidered,
          phase3LinksAccepted: nextGenPhase3Agg.phase3LinksAccepted,
          phase3NodesSeeded: nextGenPhase3Agg.phase3NodesSeeded,
          phase3RejectGap: nextGenPhase3Agg.phase3RejectGap,
          phase3RejectDistance: nextGenPhase3Agg.phase3RejectDistance,
          phase3RejectVelocity: nextGenPhase3Agg.phase3RejectVelocity,
          phase3RejectCounterFlow: nextGenPhase3Agg.phase3RejectCounterFlow,
          phase3RejectTurn: nextGenPhase3Agg.phase3RejectTurn,
          phase3RejectKalmanInnovation: nextGenPhase3Agg.phase3RejectKalmanInnovation,
        }
      : {}),
  });

  return {
    tracksCount: built.tracks.length,
    nodesCount: built.nodes.length,
    collapsedByDedup,
    consumedCount,
    watermark,
  };
}

export {
  loadDedupClosure,
  loadPendingTrackingCandidates,
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

type AssociationRuntime = {
  seedWeights: SeedWeights;
  flowWeights: FlowAlignmentWeights;
  reuseAcrossTracks: boolean;
  associationAlgorithm: AssociationAlgorithm;
  magnetismIndex: MagnetismIndex;
  magnetCost: ReturnType<typeof resolveMagnetCostWeights>;
  /** Phase W: frozen corridor index (не мутируется в assign). */
  corridorIndex: CorridorRollupIndex;
};

/** Параметры ассоциации из конфига пайплайна. */
function resolveAssociationRuntime(
  config?: TrackingPipelineConfig,
  magnetismIndex: MagnetismIndex = new Map(),
  corridorIndex: CorridorRollupIndex = EMPTY_CORRIDOR_ROLLUP_INDEX,
): AssociationRuntime {
  return {
    seedWeights: resolveSeedWeights(config),
    flowWeights: {
      flowWeight: config?.flowWeight ?? DEFAULT_FLOW_ALIGNMENT.flowWeight,
      counterFlowPenalty: config?.counterFlowPenalty ?? DEFAULT_FLOW_ALIGNMENT.counterFlowPenalty,
      flowEmpiricalMultiplier:
        config?.flowEmpiricalMultiplier ?? DEFAULT_FLOW_ALIGNMENT.flowEmpiricalMultiplier,
      counterFlowRejectCos:
        config?.counterFlowRejectCos ?? DEFAULT_FLOW_ALIGNMENT.counterFlowRejectCos,
      globalDirectionWeight:
        config?.globalDirectionWeight ?? DEFAULT_FLOW_ALIGNMENT.globalDirectionWeight,
      globalDirectionBearingDeg:
        config?.globalDirectionBearingDeg ?? DEFAULT_FLOW_ALIGNMENT.globalDirectionBearingDeg,
    },
    reuseAcrossTracks: config?.reuseAcrossTracks ?? false,
    associationAlgorithm: config?.associationAlgorithm ?? "gnn",
    magnetismIndex,
    magnetCost: resolveMagnetCostWeights(config),
    corridorIndex,
  };
}

export function buildMutableTracks(
  candidates: TrackingCandidate[],
  kin: ProfileKinematics,
  rebuildAt: Date,
  seedMin = DEFAULT_SEED_MIN,
  seedMaxFrontKm = DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  seedOpen: MutableTrack[] = [],
  assoc: AssociationRuntime = resolveAssociationRuntime(),
): { tracks: MutableTrack[]; handledIds: Set<string> } {
  const openTracks = [...seedOpen];
  const closedTracks: MutableTrack[] = [];
  const { handledIds } = assignBatch(
    candidates,
    openTracks,
    closedTracks,
    kin,
    rebuildAt,
    seedMin,
    seedMaxFrontKm,
    assoc,
  );
  return { tracks: [...openTracks, ...closedTracks], handledIds };
}

function buildTracksForProfile(
  candidates: TrackingCandidate[],
  seedOpen: MutableTrack[],
  rebuildAt: Date,
  kin: ProfileKinematics,
  seedMin = DEFAULT_SEED_MIN,
  seedMaxFrontKm = DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  assoc: AssociationRuntime = resolveAssociationRuntime(),
  config?: TrackingPipelineConfig,
  flowField?: H3VectorFlowMap,
): BuiltTracks & {
  handledIds: Set<string>;
  nextgenPhase2?: NextGenPhase2Progress;
  nextgenPhase3?: NextGenPhase3Progress;
} {
  // NextGen — отдельный batch-построитель (не GNN assignBatch).
  if (assoc.associationAlgorithm === "nextgen-gravity") {
    const built = buildTracksNextGen(candidates, rebuildAt, config, flowField, seedOpen);
    const handledIds = new Set(candidates.map(c => c.eventLocationId));
    return { ...built, handledIds };
  }

  const { tracks, handledIds } = buildMutableTracks(
    candidates,
    kin,
    rebuildAt,
    seedMin,
    seedMaxFrontKm,
    seedOpen,
    assoc,
  );
  return { ...finalizeMutableTracks(tracks, rebuildAt), handledIds };
}

function finalizeMutableTracks(allMutable: MutableTrack[], rebuildAt: Date): BuiltTracks {
  const tracks: TrajectoryTrack[] = [];
  const nodes: TrajectoryNode[] = [];

  for (const mt of allMutable) {
    if (mt.nodes.length < 1) continue;
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

type AssignBatchResult = { stats: AssignStats; handledIds: Set<string> };

/** Phase A: GNN assign на frozen weights — temporal slices + один resolveAssignments на slice. */
function assignBatch(
  candidates: TrackingCandidate[],
  openTracks: MutableTrack[],
  closedTracks: MutableTrack[],
  kin: ProfileKinematics,
  rebuildAt: Date,
  seedMin: number,
  seedMaxFrontKm: number,
  assoc: AssociationRuntime,
): AssignBatchResult {
  const stats: AssignStats = {
    links: 0,
    softLinks: 0,
    seeds: 0,
    intercepts: 0,
    skips: 0,
    attentionConflicts: 0,
  };

  const eligible = candidates.filter(canEnterAttention);
  if (eligible.length === 0) return { stats, handledIds: new Set() };

  const handledIds = new Set<string>();
  const slices = temporalAssignSlices(eligible, kin.stdbscanEpsilonTemporalMs);
  const batchConsumed = new Set<string>();

  for (const slice of slices) {
    const targets = openTracks.filter(t => !t.closed).map(t => toAttentionTarget(t));
    const { decisions, stats: sliceStats } = resolveAssignmentsForAlgorithm(
      slice,
      targets,
      kin,
      {
        consumed: batchConsumed,
        seedMin,
        seedMaxFrontDistanceKm: seedMaxFrontKm,
        seedWeights: assoc.seedWeights,
        flowWeights: assoc.flowWeights,
        reuseAcrossTracks: assoc.reuseAcrossTracks,
        associationAlgorithm: assoc.associationAlgorithm,
        corridorIndex: assoc.corridorIndex,
        magnetismIndex: assoc.magnetismIndex,
        magnetCost: assoc.magnetCost,
      },
    );

    stats.links += sliceStats.links;
    stats.softLinks += sliceStats.softLinks;
    stats.seeds += sliceStats.seeds;
    stats.intercepts += sliceStats.intercepts;
    stats.skips += sliceStats.skips;
    stats.attentionConflicts += sliceStats.attentionConflicts;

    const ordered = sortDecisionsByTime(decisions);
    for (const decision of ordered) {
      applyAssignDecision(decision, openTracks, closedTracks, kin, rebuildAt);
      if (decision.kind !== "skip") {
        handledIds.add(decision.candidate.eventLocationId);
      }
    }
  }

  return { stats, handledIds };
}

/** Применяет одно решение assign к mutable-трекам. */
function applyAssignDecision(
  decision: AssignDecision,
  openTracks: MutableTrack[],
  closedTracks: MutableTrack[],
  kin: ProfileKinematics,
  rebuildAt: Date,
): void {
  switch (decision.kind) {
    case "link": {
      const track = openTracks.find(t => t.id === decision.trackId);
      if (!track) break;
      appendNode(track, decision.candidate, kin, rebuildAt, decision.soft);
      updateMutationState(track, decision.soft, decision.candidate);
      maybeCloseTrack(track, decision.candidate, kin, openTracks, closedTracks, false);
      break;
    }
    case "seed":
      openTracks.push(startTrack(decision.candidate, kin));
      break;
    case "intercept": {
      const track = openTracks.find(t => t.id === decision.trackId);
      if (!track) break;
      appendNode(track, decision.candidate, kin, rebuildAt, false);
      maybeCloseTrack(track, decision.candidate, kin, openTracks, closedTracks, true);
      break;
    }
    case "skip":
      break;
  }
}

/** Сортировка решений по времени кандидата — Kalman остаётся каузальным. */
function sortDecisionsByTime(decisions: AssignDecision[]): AssignDecision[] {
  return [...decisions].sort(
    (a, b) => candidateOf(a).occurredAt.getTime() - candidateOf(b).occurredAt.getTime(),
  );
}

function candidateOf(d: AssignDecision): TrackingCandidate {
  return d.candidate;
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
    lastPlaceId: last.placeId,
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
function buildTracks(
  candidates: TrackingCandidate[],
  rebuildAt: Date,
  config?: TrackingPipelineConfig,
  magnetismIndex: MagnetismIndex = new Map(),
  corridorIndex: CorridorRollupIndex = EMPTY_CORRIDOR_ROLLUP_INDEX,
): BuiltTracks {
  const openTracks: MutableTrack[] = [];
  const closedTracks: MutableTrack[] = [];

  // Жадная ассоциация по току — отдельный построитель цепочек (без Kalman/GNN).
  if (config?.associationAlgorithm === "greedy-flow") {
    return buildTracksGreedyFlow(candidates, rebuildAt, config, magnetismIndex);
  }

  // NextGen 4-phase Gravity Tracking
  if (config?.associationAlgorithm === "nextgen-gravity") {
    console.log("Using NEXTGEN GRAVITY algorithm");
    return buildTracksNextGen(candidates, rebuildAt, config);
  }

  const seedMin = config?.seedMin ?? DEFAULT_SEED_MIN;
  const seedMaxFrontKm = config?.seedMaxFrontDistanceKm ?? DEFAULT_SEED_MAX_FRONT_DISTANCE_KM;
  const assoc = resolveAssociationRuntime(config, magnetismIndex, corridorIndex);

  const byProfile = groupByProfile(candidates.filter(canEnterAttention));
  for (const profile of Object.keys(byProfile) as ThreatProfile[]) {
    const kin = resolveProfileKinematics(profile, config?.profiles);
    assignBatch(byProfile[profile]!, openTracks, closedTracks, kin, rebuildAt, seedMin, seedMaxFrontKm, assoc);
  }

  return finalizeMutableTracks([...openTracks, ...closedTracks], rebuildAt);
}

/** Веса жадной ассоциации из config (дефолты — DEFAULT_GREEDY_FLOW). */
function resolveGreedyFlowWeights(config?: TrackingPipelineConfig): GreedyFlowWeights {
  const g = config?.greedyFlow;
  return {
    distWeightM: g?.distWeightM ?? DEFAULT_GREEDY_FLOW.distWeightM,
    dtPenaltyPerHourM: g?.dtPenaltyPerHourM ?? DEFAULT_GREEDY_FLOW.dtPenaltyPerHourM,
    flowAlignRewardM: g?.flowAlignRewardM ?? DEFAULT_GREEDY_FLOW.flowAlignRewardM,
    depthToleranceM: g?.depthToleranceM ?? DEFAULT_GREEDY_FLOW.depthToleranceM,
    counterFlowRejectCos: g?.counterFlowRejectCos ?? DEFAULT_GREEDY_FLOW.counterFlowRejectCos,
  };
}

/** Преобразует цепочку кандидатов в MutableTrack (kalmanState=null для greedy). */
function chainToMutable(chain: TrackingCandidate[], profile: ThreatProfile): MutableTrack {
  const id = randomUUID();
  const nodes: TrajectoryNode[] = chain.map((c, seq) => ({
    id: randomUUID(),
    trackId: id,
    seq,
    occurredAt: c.occurredAt,
    lat: c.lat,
    lon: c.lon,
    placeId: c.placeId,
    mode: c.mode,
    kalmanState: null,
    sourceRefs: c.sourceRefs,
  }));
  let totalDistanceM = 0;
  for (let i = 1; i < chain.length; i++) {
    totalDistanceM += haversineDistanceM(chain[i - 1]!.lat, chain[i - 1]!.lon, chain[i]!.lat, chain[i]!.lon);
  }
  return {
    id,
    nodes,
    profile,
    totalDistanceM,
    refLat: chain[0]!.lat,
    refLon: chain[0]!.lon,
    closed: false,
    mutationState: { phase: "stable", consecutiveSoftAssigns: 0 },
  };
}

/** Макс. open-треков из БД для NextGen join за тик (остальные — следующие батчи). */
const NEXTGEN_MAX_OPEN_TRACKS = 400;

function mutableToNextGenSeed(track: MutableTrack): NextGenSeedTrack {
  return {
    trackId: track.id,
    nodes: track.nodes,
    refLat: track.refLat,
    refLon: track.refLon,
    totalDistanceM: track.totalDistanceM,
  };
}

/**
 * NextGen Gravity. H3-поле учится на отрезках Фазы 2 внутри оркестратора
 * (см. registerSegmentFlows), а не на сырых шагах. Поле может быть передано
 * извне (run-scoped: батчи прогона обогащают его, ребилд обнуляет).
 */
function buildTracksNextGen(
  candidates: TrackingCandidate[],
  rebuildAt: Date,
  config?: TrackingPipelineConfig,
  flowField?: H3VectorFlowMap,
  seedOpen: MutableTrack[] = [],
): BuiltTracks & { nextgenPhase2: NextGenPhase2Progress; nextgenPhase3: NextGenPhase3Progress } {
  const flowMap = flowField ?? new H3VectorFlowMap(config?.nextgen?.h3Resolution ?? 8);
  const orchestrator = new NextGenOrchestrator(flowMap, config ?? {} as TrackingPipelineConfig);
  const byProfile = groupByProfile(candidates.filter(canEnterAttention));
  const mutables: MutableTrack[] = [];
  const phase2Total: NextGenPhase2Progress = {
    phase2PairsConsidered: 0,
    phase2PairsAccepted: 0,
    phase2PairsRejectedByKinematics: 0,
    phase2ReliabilityAvg: 0,
    phase2ReliabilityP95: 0,
  };
  const phase3Total: NextGenPhase3Progress = {
    phase3LinksConsidered: 0,
    phase3LinksAccepted: 0,
    phase3NodesSeeded: 0,
    phase3RejectGap: 0,
    phase3RejectDistance: 0,
    phase3RejectVelocity: 0,
    phase3RejectCounterFlow: 0,
    phase3RejectTurn: 0,
    phase3RejectKalmanInnovation: 0,
  };
  let profilesAccepted = 0;

  for (const profile of Object.keys(byProfile) as ThreatProfile[]) {
    const kin = resolveProfileKinematics(profile, config?.profiles);
    const seeds = seedOpen
      .filter(t => t.profile === profile && !t.closed)
      .sort(
        (a, b) =>
          (b.nodes[b.nodes.length - 1]?.occurredAt.getTime() ?? 0)
          - (a.nodes[a.nodes.length - 1]?.occurredAt.getTime() ?? 0),
      )
      .slice(0, NEXTGEN_MAX_OPEN_TRACKS)
      .map(mutableToNextGenSeed);
    const built = orchestrator.buildTracks(byProfile[profile]!, kin, profile, seeds);
    const tracks = built.tracks;
    phase2Total.phase2PairsConsidered += built.phase2.pairsConsidered;
    phase2Total.phase2PairsAccepted += built.phase2.pairsAccepted;
    phase2Total.phase2PairsRejectedByKinematics += built.phase2.pairsRejectedKinematics;
    if (built.phase2.pairsAccepted > 0) {
      profilesAccepted += 1;
      phase2Total.phase2ReliabilityAvg += built.phase2.reliabilityAvg;
      phase2Total.phase2ReliabilityP95 += built.phase2.reliabilityP95;
    }
    phase3Total.phase3LinksConsidered += built.phase3.linksConsidered;
    phase3Total.phase3LinksAccepted += built.phase3.linksAccepted;
    phase3Total.phase3NodesSeeded += built.phase3.nodesSeeded;
    phase3Total.phase3RejectGap += built.phase3.rejectGap;
    phase3Total.phase3RejectDistance += built.phase3.rejectDistance;
    phase3Total.phase3RejectVelocity += built.phase3.rejectVelocity;
    phase3Total.phase3RejectCounterFlow += built.phase3.rejectCounterFlow;
    phase3Total.phase3RejectTurn += built.phase3.rejectTurn;
    phase3Total.phase3RejectKalmanInnovation += built.phase3.rejectKalmanInnovation;

    for (const t of tracks) {
      mutables.push({
        id: t.id,
        nodes: t.nodes ?? [],
        profile,
        totalDistanceM: t.totalDistanceM,
        refLat: t.nodes?.[0]?.lat ?? 0,
        refLon: t.nodes?.[0]?.lon ?? 0,
        closed: false,
        mutationState: { phase: "stable", consecutiveSoftAssigns: 0 },
      });
    }
  }

  return {
    ...finalizeMutableTracks(mutables, rebuildAt),
    nextgenPhase2: {
      phase2PairsConsidered: phase2Total.phase2PairsConsidered,
      phase2PairsAccepted: phase2Total.phase2PairsAccepted,
      phase2PairsRejectedByKinematics: phase2Total.phase2PairsRejectedByKinematics,
      phase2ReliabilityAvg: profilesAccepted > 0 ? phase2Total.phase2ReliabilityAvg / profilesAccepted : 0,
      phase2ReliabilityP95: profilesAccepted > 0 ? phase2Total.phase2ReliabilityP95 / profilesAccepted : 0,
    },
    nextgenPhase3: phase3Total,
  };
}

/** Строит треки жадным алгоритмом по току (per-profile цепочки). */
function buildTracksGreedyFlow(
  candidates: TrackingCandidate[],
  rebuildAt: Date,
  config?: TrackingPipelineConfig,
  magnetismIndex: MagnetismIndex = new Map(),
): BuiltTracks {
  const weights = resolveGreedyFlowWeights(config);
  const magnetCost = resolveMagnetCostWeights(config);
  const byProfile = groupByProfile(candidates.filter(canEnterAttention));
  const mutables: MutableTrack[] = [];

  for (const profile of Object.keys(byProfile) as ThreatProfile[]) {
    const kin = resolveProfileKinematics(profile, config?.profiles);
    const chains = buildGreedyFlowChains(byProfile[profile]!, kin, {
      weights,
      magnetismIndex,
      magnetCost,
    });
    for (const chain of chains) mutables.push(chainToMutable(chain, profile));
  }

  return finalizeMutableTracks(mutables, rebuildAt);
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
    ? kalmanInitState(seed.lat, seed.lon, seed.lat, seed.lon, sigmaLatM, kin.initialVelocitySigmaMps)
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

/** Сохраняет треки и ноды в БД (внутри L1 xact, lock снаружи). */
async function persistTracksL1(
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

/** Сохраняет треки и ноды в БД (отдельный L1 write). */
async function persistTracks(
  ds: DataSource,
  built: BuiltTracks,
  rebuildGen: string,
  options?: { pruneByRebuildGen?: boolean },
): Promise<void> {
  await withTrackingL1Transaction(
    fn => ds.transaction(async em => fn((sql, params) => em.query(sql, params))),
    query => persistTracksL1(query, built, rebuildGen, options),
  );
}
