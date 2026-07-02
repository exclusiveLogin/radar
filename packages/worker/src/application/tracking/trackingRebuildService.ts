/**
 * ---
 * layer: worker/application
 * domain: tracking
 * purpose: Оркестратор rebuild L1-треков (единственный алгоритм — NextGen phase-pipeline).
 *          Фаза 1: full rebuild (truncate + insert, идемпотентен).
 *
 *          Пайплайн: loadCandidates → dedup (collapse|magnet) → NextGen phase-pipeline
 *          (cluster → field_train → join) → persist tracks + nodes.
 *          SQL read/write — infrastructure/tracking/* (см. trackingTracksReadRepository,
 *          trackingTracksWriteRepository).
 * ---
 */
import type { DataSource } from "typeorm";
import {
  PROFILE_KINEMATICS,
  resolveProfileKinematics,
  maxEpsilonTemporalMs,
  runClusteringForProfile,
  resolvePlaceGravityForRebuild,
  buildTrackMetadata,
  canEnterAttention,
  DEFAULT_SEED_WEIGHTS,
  H3VectorFlowMap,
  type SeedWeights,
  type ProfileKinematics,
  type TrackingCandidate,
  type TrackingDomainNode as TrajectoryNode,
  type ThreatProfile,
  type TrackingWatermark,
  type TrackingPipelineConfig,
  type TrackingRebuildStats,
  pickAssignableFromDedup,
  resolvePendingConsumedAfterClustering,
  withTrackingL1Transaction,
} from "@radar/shared";
import {
  loadTrackingCandidates,
  markPipelineCandidatesConsumedTx,
  isTrackingPipelineEnabled,
} from "./loadTrackingCandidates.js";
import {
  loadOpenTrackSeeds,
  type TrackingOpenTrackSeed,
} from "../../infrastructure/tracking/trackingTracksReadRepository.js";
import {
  writeTracks,
  writeTracksL1,
  type BuiltTracks,
} from "../../infrastructure/tracking/trackingTracksWriteRepository.js";
import { buildTracksViaNextGenPipeline, type TrackingClusterPhaseStats } from "./pipeline/index.js";
import { randomUUID } from "crypto";

type RebuildOptions = {
  since: Date;
  until: Date;
  rebuildGen?: string;
  /** false — dry-run, не сохраняет. */
  persist?: boolean;
  /** Конфиг пайплайна: оверрайды кинематики, веса потока, NextGen-параметры. */
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

  // 2. Дедупликация per-profile (collapse или magnet)
  const byProfile = groupByProfile(allCandidates);
  const allDeduped: TrackingCandidate[] = [];
  let collapsedByDedup = 0;
  const seedWeights = resolveSeedWeights(opts.config);
  const gravityIndex = resolvePlaceGravityForRebuild(allCandidates, opts.config, seedWeights);

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
  }

  allDeduped.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const builtTracks = buildTracksNextGen(allDeduped, until, opts.config);

  if (persist && builtTracks.tracks.length > 0) {
    await writeTracks(ds, builtTracks, rebuildGen, {
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

type NextGenClusterProgress = {
  candidatesIn: number;
  nodesOut: number;
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

/** Инкрементальный батч: per-profile ST-DBSCAN dedup + NextGen phase-pipeline + UPSERT. */
export async function runIncrementalBatch(
  ds: DataSource,
  opts: IncrementalBatchOptions,
): Promise<IncrementalBatchResult> {
  const rebuildAt = opts.rebuildAt ?? new Date();
  const chunkIds = new Set(opts.candidates.map(c => c.eventLocationId));
  const fullPendingIds = opts.fullPendingIds ?? chunkIds;
  const dedupClosure = opts.dedupClosure ?? opts.candidates;
  await emitProgress(opts.onProgress, { stage: "loading" });

  const openTrackSeeds = await loadOpenTrackSeeds(ds, rebuildAt, opts.config);
  const byProfile = groupByProfile(dedupClosure);
  let collapsedByDedup = 0;
  let stdbscanClusters = 0;
  let kalmanTracksOpen = 0;
  let kalmanTracksClosed = 0;
  let kalmanNodesAdded = 0;
  const nextGenClusterAgg: NextGenClusterProgress = { candidatesIn: 0, nodesOut: 0 };
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

  for (const profile of Object.keys(byProfile) as ThreatProfile[]) {
    await emitProgress(opts.onProgress, { stage: "cluster" });
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

    const toAssign = pickAssignableFromDedup(result.candidates, chunkIds);

    await emitProgress(opts.onProgress, {
      stage: "cluster",
      stdbscanClusters,
      stdbscanCollapsed: collapsedByDedup,
    });

    await emitProgress(opts.onProgress, { stage: "join" });
    const kin = resolveProfileKinematics(profile, opts.config?.profiles);
    const seeds = pickProfileSeeds(openTrackSeeds, profile);
    const profileBuilt = buildTracksNextGenForProfile(toAssign, profile, kin, opts.config, opts.flowField, seeds);
    for (const c of toAssign) handledIds.add(c.eventLocationId);
    built.tracks.push(...profileBuilt.tracks);
    built.nodes.push(...profileBuilt.nodes);
    kalmanTracksOpen += profileBuilt.tracks.filter(t => t.status === "active").length;
    kalmanTracksClosed += profileBuilt.tracks.filter(t => t.status === "closed").length;
    kalmanNodesAdded += profileBuilt.nodes.length;
    nextGenClusterAgg.candidatesIn += profileBuilt.nextgenCluster.candidatesIn;
    nextGenClusterAgg.nodesOut += profileBuilt.nextgenCluster.nodesOut;
    nextGenPhase2Agg.phase2PairsConsidered += profileBuilt.nextgenPhase2.phase2PairsConsidered;
    nextGenPhase2Agg.phase2PairsAccepted += profileBuilt.nextgenPhase2.phase2PairsAccepted;
    nextGenPhase2Agg.phase2PairsRejectedByKinematics += profileBuilt.nextgenPhase2.phase2PairsRejectedByKinematics;
    if (profileBuilt.nextgenPhase2.phase2PairsAccepted > 0) {
      nextGenProfilesWithAccepted += 1;
      nextGenPhase2Agg.phase2ReliabilityAvg += profileBuilt.nextgenPhase2.phase2ReliabilityAvg;
      nextGenPhase2Agg.phase2ReliabilityP95 += profileBuilt.nextgenPhase2.phase2ReliabilityP95;
    }
    nextGenPhase3Agg.phase3LinksConsidered += profileBuilt.nextgenPhase3.phase3LinksConsidered;
    nextGenPhase3Agg.phase3LinksAccepted += profileBuilt.nextgenPhase3.phase3LinksAccepted;
    nextGenPhase3Agg.phase3NodesSeeded += profileBuilt.nextgenPhase3.phase3NodesSeeded;
    nextGenPhase3Agg.phase3RejectGap += profileBuilt.nextgenPhase3.phase3RejectGap;
    nextGenPhase3Agg.phase3RejectDistance += profileBuilt.nextgenPhase3.phase3RejectDistance;
    nextGenPhase3Agg.phase3RejectVelocity += profileBuilt.nextgenPhase3.phase3RejectVelocity;
    nextGenPhase3Agg.phase3RejectCounterFlow += profileBuilt.nextgenPhase3.phase3RejectCounterFlow;
    nextGenPhase3Agg.phase3RejectTurn += profileBuilt.nextgenPhase3.phase3RejectTurn;
    nextGenPhase3Agg.phase3RejectKalmanInnovation += profileBuilt.nextgenPhase3.phase3RejectKalmanInnovation;

    await emitProgress(opts.onProgress, {
      stage: "join",
      stdbscanClusters,
      stdbscanCollapsed: collapsedByDedup,
      kalmanTracksOpen,
      kalmanTracksClosed,
      kalmanNodesAdded,
      ...nextGenProgressPatch(
        nextGenClusterAgg,
        nextGenPhase2Agg,
        nextGenPhase3Agg,
        nextGenProfilesWithAccepted,
        { tracksOpen: kalmanTracksOpen, tracksClosed: kalmanTracksClosed, nodesAdded: kalmanNodesAdded },
      ),
    });
  }

  await emitProgress(opts.onProgress, {
    stage: "persisting",
    stdbscanClusters,
    stdbscanCollapsed: collapsedByDedup,
    kalmanTracksOpen,
    kalmanTracksClosed,
    kalmanNodesAdded,
    ...nextGenProgressPatch(
      nextGenClusterAgg,
      nextGenPhase2Agg,
      nextGenPhase3Agg,
      nextGenProfilesWithAccepted,
      { tracksOpen: kalmanTracksOpen, tracksClosed: kalmanTracksClosed, nodesAdded: kalmanNodesAdded },
    ),
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
          await writeTracksL1(query, built, opts.rebuildGen, { pruneByRebuildGen: false });
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
    ...nextGenProgressPatch(
      nextGenClusterAgg,
      nextGenPhase2Agg,
      nextGenPhase3Agg,
      nextGenProfilesWithAccepted,
      { tracksOpen: kalmanTracksOpen, tracksClosed: kalmanTracksClosed, nodesAdded: kalmanNodesAdded },
    ),
  });

  return {
    tracksCount: built.tracks.length,
    nodesCount: built.nodes.length,
    collapsedByDedup,
    consumedCount,
    watermark,
  };
}

function nextGenProgressPatch(
  cluster: NextGenClusterProgress,
  phase2: NextGenPhase2Progress,
  phase3: NextGenPhase3Progress,
  profilesWithAccepted: number,
  joinTrackCounts: { tracksOpen: number; tracksClosed: number; nodesAdded: number },
): Partial<TrackingRebuildStats> {
  const reliabilityAvg = profilesWithAccepted > 0 ? phase2.phase2ReliabilityAvg / profilesWithAccepted : 0;
  const reliabilityP95 = profilesWithAccepted > 0 ? phase2.phase2ReliabilityP95 / profilesWithAccepted : 0;
  return {
    ...(phase2.phase2PairsConsidered > 0
      ? {
          phase2PairsConsidered: phase2.phase2PairsConsidered,
          phase2PairsAccepted: phase2.phase2PairsAccepted,
          phase2PairsRejectedByKinematics: phase2.phase2PairsRejectedByKinematics,
          phase2ReliabilityAvg: reliabilityAvg,
          phase2ReliabilityP95: reliabilityP95,
        }
      : {}),
    ...(phase3.phase3LinksConsidered > 0
      ? {
          phase3LinksConsidered: phase3.phase3LinksConsidered,
          phase3LinksAccepted: phase3.phase3LinksAccepted,
          phase3NodesSeeded: phase3.phase3NodesSeeded,
          phase3RejectGap: phase3.phase3RejectGap,
          phase3RejectDistance: phase3.phase3RejectDistance,
          phase3RejectVelocity: phase3.phase3RejectVelocity,
          phase3RejectCounterFlow: phase3.phase3RejectCounterFlow,
          phase3RejectTurn: phase3.phase3RejectTurn,
          phase3RejectKalmanInnovation: phase3.phase3RejectKalmanInnovation,
        }
      : {}),
    phaseStats: {
      ...(cluster.candidatesIn > 0
        ? { cluster: { candidatesIn: cluster.candidatesIn, nodesOut: cluster.nodesOut } }
        : {}),
      ...(phase2.phase2PairsConsidered > 0
        ? {
            field_train: {
              pairsConsidered: phase2.phase2PairsConsidered,
              pairsAccepted: phase2.phase2PairsAccepted,
              pairsRejectedByKinematics: phase2.phase2PairsRejectedByKinematics,
              reliabilityAvg,
              reliabilityP95,
            },
          }
        : {}),
      ...(phase3.phase3LinksConsidered > 0
        ? {
            join: {
              linksConsidered: phase3.phase3LinksConsidered,
              linksAccepted: phase3.phase3LinksAccepted,
              nodesSeeded: phase3.phase3NodesSeeded,
              ...joinTrackCounts,
              rejectGap: phase3.phase3RejectGap,
              rejectDistance: phase3.phase3RejectDistance,
              rejectVelocity: phase3.phase3RejectVelocity,
              rejectCounterFlow: phase3.phase3RejectCounterFlow,
              rejectTurn: phase3.phase3RejectTurn,
              rejectKalmanInnovation: phase3.phase3RejectKalmanInnovation,
            },
          }
        : {}),
    },
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

/** Веса географии из конфига пайплайна (фолбэк — дефолты домена); питают dedup gravity index. */
function resolveSeedWeights(config?: TrackingPipelineConfig): SeedWeights {
  return {
    regionFront: config?.seedRegionFront ?? DEFAULT_SEED_WEIGHTS.regionFront,
    regionInteriorRf: config?.seedRegionInteriorRf ?? DEFAULT_SEED_WEIGHTS.regionInteriorRf,
    frontProximityD0Km: config?.seedFrontProximityD0Km ?? DEFAULT_SEED_WEIGHTS.frontProximityD0Km,
  };
}

/** Открытые треки БД, отфильтрованные и упорядоченные для join-фазы одного профиля. */
function pickProfileSeeds(
  seeds: TrackingOpenTrackSeed[],
  profile: ThreatProfile,
): TrackingOpenTrackSeed[] {
  return seeds
    .filter(s => s.profile === profile)
    .sort(
      (a, b) =>
        (b.nodes[b.nodes.length - 1]?.occurredAt.getTime() ?? 0)
        - (a.nodes[a.nodes.length - 1]?.occurredAt.getTime() ?? 0),
    )
    .slice(0, NEXTGEN_MAX_OPEN_TRACKS);
}

/** Собранный трек до финального пересчёта метаданных (status/firstAt/lastAt/…). */
type TrackNodesDraft = {
  id: string;
  nodes: TrajectoryNode[];
  profile: ThreatProfile;
  totalDistanceM: number;
};

function finalizeTracks(drafts: TrackNodesDraft[], rebuildAt: Date): BuiltTracks {
  const tracks: BuiltTracks["tracks"] = [];
  const nodes: TrajectoryNode[] = [];

  for (const draft of drafts) {
    if (draft.nodes.length < 1) continue;
    const kin = PROFILE_KINEMATICS[draft.profile];
    const meta = buildTrackMetadata(draft.nodes, kin, rebuildAt);
    tracks.push({
      id: draft.id,
      status: meta.status,
      threatProfile: draft.profile,
      firstAt: meta.firstAt,
      lastAt: meta.lastAt,
      lastLat: meta.lastLat,
      lastLon: meta.lastLon,
      velocityMs: meta.velocityMs,
      bearingDeg: meta.bearingDeg,
      nodeCount: meta.nodeCount,
      totalDistanceM: draft.totalDistanceM,
    });
    nodes.push(...draft.nodes.map((n, i) => ({ ...n, seq: i })));
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

/** Макс. open-треков из БД для NextGen join за тик (остальные — следующие батчи). */
const NEXTGEN_MAX_OPEN_TRACKS = 400;

type NextGenBuildProgress = {
  nextgenCluster: TrackingClusterPhaseStats;
  nextgenPhase2: NextGenPhase2Progress;
  nextgenPhase3: NextGenPhase3Progress;
};

/**
 * NextGen Gravity через phase-pipeline (см. ./pipeline). H3-поле учится на отрезках
 * field_train-фазы внутри одного вызова на профиль (run-scoped, обогащается между тиками).
 */
function buildTracksNextGenForProfile(
  candidates: TrackingCandidate[],
  profile: ThreatProfile,
  kin: ProfileKinematics,
  config: TrackingPipelineConfig | undefined,
  flowField: H3VectorFlowMap | undefined,
  seeds: TrackingOpenTrackSeed[],
): BuiltTracks & NextGenBuildProgress {
  const flowMap = flowField ?? new H3VectorFlowMap(config?.nextgen?.h3Resolution ?? 8);
  const eligible = candidates.filter(canEnterAttention);
  const built = buildTracksViaNextGenPipeline(
    eligible,
    kin,
    profile,
    config ?? ({} as TrackingPipelineConfig),
    flowMap,
    seeds,
  );

  const drafts: TrackNodesDraft[] = built.tracks.map(t => ({
    id: t.id,
    nodes: t.nodes ?? [],
    profile,
    totalDistanceM: t.totalDistanceM,
  }));

  return {
    ...finalizeTracks(drafts, new Date()),
    nextgenCluster: built.cluster,
    nextgenPhase2: {
      phase2PairsConsidered: built.phase2.pairsConsidered,
      phase2PairsAccepted: built.phase2.pairsAccepted,
      phase2PairsRejectedByKinematics: built.phase2.pairsRejectedKinematics,
      phase2ReliabilityAvg: built.phase2.reliabilityAvg,
      phase2ReliabilityP95: built.phase2.reliabilityP95,
    },
    nextgenPhase3: {
      phase3LinksConsidered: built.phase3.linksConsidered,
      phase3LinksAccepted: built.phase3.linksAccepted,
      phase3NodesSeeded: built.phase3.nodesSeeded,
      phase3RejectGap: built.phase3.rejectGap,
      phase3RejectDistance: built.phase3.rejectDistance,
      phase3RejectVelocity: built.phase3.rejectVelocity,
      phase3RejectCounterFlow: built.phase3.rejectCounterFlow,
      phase3RejectTurn: built.phase3.rejectTurn,
      phase3RejectKalmanInnovation: built.phase3.rejectKalmanInnovation,
    },
  };
}

/** Full-rebuild вариант: без seed-треков из БД (полная перестройка с нуля). */
function buildTracksNextGen(
  candidates: TrackingCandidate[],
  rebuildAt: Date,
  config?: TrackingPipelineConfig,
): BuiltTracks {
  const byProfile = groupByProfile(candidates.filter(canEnterAttention));
  const drafts: TrackNodesDraft[] = [];
  const flowMap = new H3VectorFlowMap(config?.nextgen?.h3Resolution ?? 8);

  for (const profile of Object.keys(byProfile) as ThreatProfile[]) {
    const kin = resolveProfileKinematics(profile, config?.profiles);
    const built = buildTracksViaNextGenPipeline(byProfile[profile]!, kin, profile, config ?? ({} as TrackingPipelineConfig), flowMap);
    for (const t of built.tracks) {
      drafts.push({ id: t.id, nodes: t.nodes ?? [], profile, totalDistanceM: t.totalDistanceM });
    }
  }

  return finalizeTracks(drafts, rebuildAt);
}

/** Группирует кандидатов по профилю угрозы для независимого dedup/pipeline прогона. */
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
