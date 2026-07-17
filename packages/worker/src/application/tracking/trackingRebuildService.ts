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
import { buildTracksViaNextGenPipeline, type TrackingClusterStepStats } from "./pipeline/index.js";
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
  /** Candidate window для ST-DBSCAN; по умолчанию = candidates. */
  candidateWindow?: TrackingCandidate[];
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

type NextGenStep2Progress = {
  step2PairsConsidered: number;
  step2PairsAccepted: number;
  step2PairsRejectedByKinematics: number;
  step2ReliabilityAvg: number;
  step2ReliabilityP95: number;
};

type NextGenStep3Progress = {
  step3LinksConsidered: number;
  step3LinksAccepted: number;
  step3NodesSeeded: number;
  step3RejectGap: number;
  step3RejectDistance: number;
  step3RejectVelocity: number;
  step3RejectCounterFlow: number;
  step3RejectTurn: number;
  step3RejectKalmanInnovation: number;
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
  const candidateWindow = opts.candidateWindow ?? opts.candidates;
  await emitProgress(opts.onProgress, { stage: "loading" });

  const openTrackSeeds = await loadOpenTrackSeeds(ds, rebuildAt, opts.config);
  const byProfile = groupByProfile(candidateWindow);
  let collapsedByDedup = 0;
  let stdbscanClusters = 0;
  let kalmanTracksOpen = 0;
  let kalmanTracksClosed = 0;
  let kalmanNodesAdded = 0;
  const nextGenClusterAgg: NextGenClusterProgress = { candidatesIn: 0, nodesOut: 0 };
  const nextGenStep2Agg: NextGenStep2Progress = {
    step2PairsConsidered: 0,
    step2PairsAccepted: 0,
    step2PairsRejectedByKinematics: 0,
    step2ReliabilityAvg: 0,
    step2ReliabilityP95: 0,
  };
  const nextGenStep3Agg: NextGenStep3Progress = {
    step3LinksConsidered: 0,
    step3LinksAccepted: 0,
    step3NodesSeeded: 0,
    step3RejectGap: 0,
    step3RejectDistance: 0,
    step3RejectVelocity: 0,
    step3RejectCounterFlow: 0,
    step3RejectTurn: 0,
    step3RejectKalmanInnovation: 0,
  };
  let nextGenProfilesWithAccepted = 0;
  const built: BuiltTracks = { tracks: [], nodes: [] };
  const dedupWinnerIds = new Set<string>();
  const handledIds = new Set<string>();

  const seedWeights = resolveSeedWeights(opts.config);
  const gravityIndex = resolvePlaceGravityForRebuild(candidateWindow, opts.config, seedWeights);

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
    nextGenStep2Agg.step2PairsConsidered += profileBuilt.nextgenStep2.step2PairsConsidered;
    nextGenStep2Agg.step2PairsAccepted += profileBuilt.nextgenStep2.step2PairsAccepted;
    nextGenStep2Agg.step2PairsRejectedByKinematics += profileBuilt.nextgenStep2.step2PairsRejectedByKinematics;
    if (profileBuilt.nextgenStep2.step2PairsAccepted > 0) {
      nextGenProfilesWithAccepted += 1;
      nextGenStep2Agg.step2ReliabilityAvg += profileBuilt.nextgenStep2.step2ReliabilityAvg;
      nextGenStep2Agg.step2ReliabilityP95 += profileBuilt.nextgenStep2.step2ReliabilityP95;
    }
    nextGenStep3Agg.step3LinksConsidered += profileBuilt.nextgenStep3.step3LinksConsidered;
    nextGenStep3Agg.step3LinksAccepted += profileBuilt.nextgenStep3.step3LinksAccepted;
    nextGenStep3Agg.step3NodesSeeded += profileBuilt.nextgenStep3.step3NodesSeeded;
    nextGenStep3Agg.step3RejectGap += profileBuilt.nextgenStep3.step3RejectGap;
    nextGenStep3Agg.step3RejectDistance += profileBuilt.nextgenStep3.step3RejectDistance;
    nextGenStep3Agg.step3RejectVelocity += profileBuilt.nextgenStep3.step3RejectVelocity;
    nextGenStep3Agg.step3RejectCounterFlow += profileBuilt.nextgenStep3.step3RejectCounterFlow;
    nextGenStep3Agg.step3RejectTurn += profileBuilt.nextgenStep3.step3RejectTurn;
    nextGenStep3Agg.step3RejectKalmanInnovation += profileBuilt.nextgenStep3.step3RejectKalmanInnovation;

    await emitProgress(opts.onProgress, {
      stage: "join",
      stdbscanClusters,
      stdbscanCollapsed: collapsedByDedup,
      kalmanTracksOpen,
      kalmanTracksClosed,
      kalmanNodesAdded,
      ...nextGenProgressPatch(
        nextGenClusterAgg,
        nextGenStep2Agg,
        nextGenStep3Agg,
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
      nextGenStep2Agg,
      nextGenStep3Agg,
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
      nextGenStep2Agg,
      nextGenStep3Agg,
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
  step2: NextGenStep2Progress,
  step3: NextGenStep3Progress,
  profilesWithAccepted: number,
  joinTrackCounts: { tracksOpen: number; tracksClosed: number; nodesAdded: number },
): Partial<TrackingRebuildStats> {
  const reliabilityAvg = profilesWithAccepted > 0 ? step2.step2ReliabilityAvg / profilesWithAccepted : 0;
  const reliabilityP95 = profilesWithAccepted > 0 ? step2.step2ReliabilityP95 / profilesWithAccepted : 0;
  return {
    ...(step2.step2PairsConsidered > 0
      ? {
          step2PairsConsidered: step2.step2PairsConsidered,
          step2PairsAccepted: step2.step2PairsAccepted,
          step2PairsRejectedByKinematics: step2.step2PairsRejectedByKinematics,
          step2ReliabilityAvg: reliabilityAvg,
          step2ReliabilityP95: reliabilityP95,
        }
      : {}),
    ...(step3.step3LinksConsidered > 0
      ? {
          step3LinksConsidered: step3.step3LinksConsidered,
          step3LinksAccepted: step3.step3LinksAccepted,
          step3NodesSeeded: step3.step3NodesSeeded,
          step3RejectGap: step3.step3RejectGap,
          step3RejectDistance: step3.step3RejectDistance,
          step3RejectVelocity: step3.step3RejectVelocity,
          step3RejectCounterFlow: step3.step3RejectCounterFlow,
          step3RejectTurn: step3.step3RejectTurn,
          step3RejectKalmanInnovation: step3.step3RejectKalmanInnovation,
        }
      : {}),
    stepStats: {
      ...(cluster.candidatesIn > 0
        ? { cluster: { candidatesIn: cluster.candidatesIn, nodesOut: cluster.nodesOut } }
        : {}),
      ...(step2.step2PairsConsidered > 0
        ? {
            field_train: {
              pairsConsidered: step2.step2PairsConsidered,
              pairsAccepted: step2.step2PairsAccepted,
              pairsRejectedByKinematics: step2.step2PairsRejectedByKinematics,
              reliabilityAvg,
              reliabilityP95,
            },
          }
        : {}),
      ...(step3.step3LinksConsidered > 0
        ? {
            join: {
              linksConsidered: step3.step3LinksConsidered,
              linksAccepted: step3.step3LinksAccepted,
              nodesSeeded: step3.step3NodesSeeded,
              ...joinTrackCounts,
              rejectGap: step3.step3RejectGap,
              rejectDistance: step3.step3RejectDistance,
              rejectVelocity: step3.step3RejectVelocity,
              rejectCounterFlow: step3.step3RejectCounterFlow,
              rejectTurn: step3.step3RejectTurn,
              rejectKalmanInnovation: step3.step3RejectKalmanInnovation,
            },
          }
        : {}),
    },
  };
}

export {
  loadCandidateWindow,
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
  nextgenCluster: TrackingClusterStepStats;
  nextgenStep2: NextGenStep2Progress;
  nextgenStep3: NextGenStep3Progress;
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
    nextgenStep2: {
      step2PairsConsidered: built.step2.pairsConsidered,
      step2PairsAccepted: built.step2.pairsAccepted,
      step2PairsRejectedByKinematics: built.step2.pairsRejectedKinematics,
      step2ReliabilityAvg: built.step2.reliabilityAvg,
      step2ReliabilityP95: built.step2.reliabilityP95,
    },
    nextgenStep3: {
      step3LinksConsidered: built.step3.linksConsidered,
      step3LinksAccepted: built.step3.linksAccepted,
      step3NodesSeeded: built.step3.nodesSeeded,
      step3RejectGap: built.step3.rejectGap,
      step3RejectDistance: built.step3.rejectDistance,
      step3RejectVelocity: built.step3.rejectVelocity,
      step3RejectCounterFlow: built.step3.rejectCounterFlow,
      step3RejectTurn: built.step3.rejectTurn,
      step3RejectKalmanInnovation: built.step3.rejectKalmanInnovation,
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
