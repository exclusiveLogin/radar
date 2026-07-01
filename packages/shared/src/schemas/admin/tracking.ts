/**
 * ---
 * layer: shared
 * kind: schema
 * domain: admin/tracking
 * tooling: zod
 * purpose: Контракты admin API и WS для пайплайна треков.
 * ---
 */
import { z } from "zod";
import { threatProfileSchema } from "../map/tracks";

export const trackingRebuildStageSchema = z.enum([
  "idle",
  "loading",
  "stdbscan",
  "kalman",
  "persisting",
  "done",
]);

export const trackingWatermarkSchema = z.object({
  lastOccurredAt: z.string().datetime(),
  lastEventLocationId: z.string().uuid(),
});

export const trackingRebuildStatsSchema = z.object({
  stage: trackingRebuildStageSchema,
  /** Размер тика daemon (сколько pending assign за проход). Dedup closure — глобальный. */
  batchSize: z.number().int().nonnegative().optional(),
  /** Точек в pending-очереди тика. */
  pendingCandidates: z.number().int().nonnegative().optional(),
  /** Размер dedup closure (pending + consumed якоря). */
  dedupClosureSize: z.number().int().nonnegative().optional(),
  batchIndex: z.number().int().nonnegative().optional(),
  processedCandidates: z.number().int().nonnegative().optional(),
  totalCandidates: z.number().int().nonnegative().optional(),
  percentApprox: z.number().min(0).max(100).optional(),
  stdbscanClusters: z.number().int().nonnegative().optional(),
  stdbscanCollapsed: z.number().int().nonnegative().optional(),
  kalmanTracksOpen: z.number().int().nonnegative().optional(),
  kalmanTracksClosed: z.number().int().nonnegative().optional(),
  kalmanNodesAdded: z.number().int().nonnegative().optional(),
  attentionConflicts: z.number().int().nonnegative().optional(),
  softAssigns: z.number().int().nonnegative().optional(),
  /** Ф2 NextGen: сколько пар рассмотрено в окне обучения H3. */
  phase2PairsConsidered: z.number().int().nonnegative().optional(),
  /** Ф2 NextGen: сколько пар прошло векторацию и попало в поле. */
  phase2PairsAccepted: z.number().int().nonnegative().optional(),
  /** Ф2 NextGen: сколько пар отклонено кинематическим коррелятором. */
  phase2PairsRejectedByKinematics: z.number().int().nonnegative().optional(),
  /** Ф2 NextGen: средняя достоверность принятых пар (0..1). */
  phase2ReliabilityAvg: z.number().min(0).max(1).optional(),
  /** Ф2 NextGen: P95 достоверности принятых пар (0..1). */
  phase2ReliabilityP95: z.number().min(0).max(1).optional(),
  /** Ф3 NextGen: сколько candidate→track линков оценено. */
  phase3LinksConsidered: z.number().int().nonnegative().optional(),
  /** Ф3 NextGen: сколько линков принято и привело к append ноды. */
  phase3LinksAccepted: z.number().int().nonnegative().optional(),
  /** Ф3 NextGen: сколько нод засеяно новым треком (не нашли валидный link). */
  phase3NodesSeeded: z.number().int().nonnegative().optional(),
  /** Ф3 NextGen reject-диагностика по причинам. */
  phase3RejectGap: z.number().int().nonnegative().optional(),
  phase3RejectDistance: z.number().int().nonnegative().optional(),
  phase3RejectVelocity: z.number().int().nonnegative().optional(),
  phase3RejectCounterFlow: z.number().int().nonnegative().optional(),
  phase3RejectTurn: z.number().int().nonnegative().optional(),
  phase3RejectKalmanInnovation: z.number().int().nonnegative().optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
});

/** Агрегированные метрики пайплайна для админки. */
export const trackingPipelineMetricsSchema = z.object({
  totalCandidatesGeo: z.number().int().nonnegative(),
  totalTargetCandidates: z.number().int().nonnegative(),
  /** Очередь: ещё не прошли пайплайн. */
  unconsumedPipeline: z.number().int().nonnegative(),
  /** Размер dedup closure (pending + consumed-якоря) — live для админки. */
  dedupClosureSize: z.number().int().nonnegative().optional(),
  /** Фактический размер тика daemon с учётом cap. */
  effectiveBatchSize: z.number().int().positive().optional(),
  processedCandidates: z.number().int().nonnegative(),
  /** % точек, прошедших пайплайн (не = % нод в треках). */
  percentProcessed: z.number().min(0).max(100),
  percentPipelineProcessed: z.number().min(0).max(100),
  nodesInTracks: z.number().int().nonnegative(),
  percentNodesInTracks: z.number().min(0).max(100),
  tracksActive: z.number().int().nonnegative(),
  tracksClosed: z.number().int().nonnegative(),
  tracksStale: z.number().int().nonnegative(),
  tracksTotal: z.number().int().nonnegative(),
  attentionConflicts: z.number().int().nonnegative().optional(),
  softAssigns: z.number().int().nonnegative().optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
  runStartedAt: z.string().datetime().nullable().optional(),
});

export const trackingRebuildRunSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["running", "paused", "done", "failed", "cancelled"]),
  mode: z.enum(["incremental", "full_rebuild", "soft_rebuild"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  since: z.string().datetime(),
  until: z.string().datetime(),
  rebuildGen: z.string(),
  stats: trackingRebuildStatsSchema.partial(),
  checkpoint: trackingWatermarkSchema.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const trackingPipelineConfigSchema = z.object({
  /** Точек за тик daemon (assign/persist). ST-DBSCAN closure — вся очередь + якоря. */
  batchSize: z.number().int().min(10).max(20000).default(500),
  daemonIntervalMs: z.number().int().min(5000).max(300000).optional(),
  seedMin: z.number().min(0).max(5).default(0.45),
  /** Seed только если front_distance_km ≤ порога (км от фронта). */
  seedMaxFrontDistanceKm: z.number().positive().max(10000).default(450),
  /** Буст веса seed у фронт-региона (множитель). */
  seedRegionFront: z.number().min(0).max(10).default(1.35),
  /** Штраф веса seed в глубине РФ (множитель < 1 гасит обратный поток). */
  seedRegionInteriorRf: z.number().min(0).max(10).default(0.5),
  /** Длина затухания близости к фронту, км (exp(−d/D0)). */
  seedFrontProximityD0Km: z.number().positive().max(10000).default(400),
  /** Точка во все in-locus треки (self-attention fan-out). */
  reuseAcrossTracks: z.boolean().default(false),
  /** Алгоритм ассоциации (GNN default; PDAF/JPDAF — backlog; greedy-flow — жадный по току; nextgen-gravity — 4-phase H3 gravity). */
  associationAlgorithm: z.enum(["gnn", "pdaf", "jpdaf", "greedy-flow", "nextgen-gravity"]).default("gnn"),
  /** γ_ток — бонус за движение по потоку (1 = умеренный эффект, 0 = выкл). */
  flowWeight: z.number().min(0).max(10).default(1),
  /** γ_против — штраф за противоток (1 = умеренный эффект, 0 = выкл). */
  counterFlowPenalty: z.number().min(0).max(10).default(1),
  /** Множитель эмпирического коридора: сила B = count × multiplier. */
  flowEmpiricalMultiplier: z.number().min(0).max(10).default(1),
  /**
   * Жёсткий gate против тока: мин. допустимый cos∠(шаг, ток фронт→тыл).
   * null — выкл; 0 — резать любой шаг к фронту; −0.2 — допускать боковой дрейф.
   */
  counterFlowRejectCos: z.number().min(-1).max(1).nullable().default(null),
  /** Вес глобального directional-bias по cos (0 — выкл). */
  globalDirectionWeight: z.number().min(0).max(10).default(0),
  /** Глобальный азимут directional-bias (градусы, 0=север, 90=восток). null — выкл. */
  globalDirectionBearingDeg: z.number().min(0).max(360).nullable().default(null),
  /** Веса жадной ассоциации (associationAlgorithm = "greedy-flow"). */
  greedyFlow: z
    .object({
      /** Вклад дистанции (м) в стоимость ребра. */
      distWeightM: z.number().min(0).default(1),
      /** Штраф за час разрыва (м-эквивалент на 1 ч). */
      dtPenaltyPerHourM: z.number().min(0).default(20_000),
      /** Награда за совпадение с током (м-эквивалент при align=1). */
      flowAlignRewardM: z.number().min(0).default(50_000),
      /** Допуск «не глубже» (м): шаг к фронту разрешён не более чем на ε. */
      depthToleranceM: z.number().min(0).default(20_000),
      /** Жёсткий gate против тока: мин. cos∠(шаг, ток). null — выкл. */
      counterFlowRejectCos: z.number().min(-1).max(1).nullable().default(-0.2),
    })
    .default({}),
  /** Режим ST-DBSCAN: collapse (legacy) или magnet (веса без схлопывания). */
  clusteringMode: z.enum(["collapse", "magnet"]).default("collapse"),
  /** Параметры 4-х фазного алгоритма NextGen Gravity. */
  nextgen: z
    .object({
      /** Разрешение H3 сетки для глобального векторного поля. */
      h3Resolution: z.number().int().min(4).max(12).default(8),
      /** Минимальная масса отрезка, чтобы он стал центром гравитации (Фаза 3). */
      gravityCenterMassThreshold: z.number().min(0).default(5),
      /** Порог расстояния Махаланобиса для слияния с магистралью. */
      kalmanLocusChi2Threshold: z.number().min(0).default(5.99),
      /** Мин. число нод, чтобы цепочка стала сплошной магистралью (иначе — пунктир-сателлит). */
      minBackboneNodes: z.number().int().min(2).max(10).default(3),
      /** Сила штрафа за поворот трассы (множитель стоимости при развороте 180°; 0 = выкл). */
      turnPenaltyWeight: z.number().min(0).max(10).default(3),
      /** Жёсткий запрет поворота круче этого (град): шаг назад по курсу = разрыв трассы. */
      maxTurnDeg: z.number().min(0).max(180).default(135),
      /** Включить ли 4 фазу (Reverse Forward Loop). */
      rflEnabled: z.boolean().default(true),
      /**
       * Мягкий порог cos для Phase2 (ниже — отрезок не строится).
       * По умолчанию = counterFlowRejectCos из корня конфига.
       */
      rflPenaltyThreshold: z.number().min(-1).max(1).optional(),
    })
    .default({}),
  /** Параметры магнитной фазы и cost-хелпера. */
  magnet: z
    .object({
      wMag: z.number().min(0).max(20).default(1),
      wFlow: z.number().min(0).max(20).default(0),
      lambdaCloud: z.number().min(0).max(10).default(0.5),
      lambdaHist: z.number().min(0).max(10).default(0.3),
      useHistoricalGravity: z.boolean().default(false),
      geohashPrecision: z.number().int().min(3).max(10).default(5),
    })
    .default({}),
  tieEpsilon: z.number().positive().default(0.5),
  maxTuneEpochs: z.number().int().min(1).max(50).default(12),
  initialStepFraction: z.number().min(0.1).max(1).default(0.5),
  minStepFraction: z.number().min(0.01).max(0.5).default(0.05),
  profiles: z
    .record(
      threatProfileSchema,
      z
        .object({
          maxVelocityMs: z.number().positive().optional(),
          maxLinkDistanceM: z.number().positive().optional(),
          maxGapMs: z.number().positive().optional(),
          staleAfterMs: z.number().positive().optional(),
          maxTrackDurationMs: z.number().positive().optional(),
          maxRangeFromOriginM: z.number().positive().optional(),
          stdbscanEpsilonSpatialM: z.number().positive().optional(),
          stdbscanEpsilonTemporalMs: z.number().positive().optional(),
          stdbscanMinPts: z.number().int().min(2).optional(),
          processNoiseScale: z.number().positive().optional(),
          observationSigmaScale: z.number().positive().optional(),
          chi2Threshold: z.number().positive().optional(),
          locusAnisotropyRatio: z.number().min(1).optional(),
          initialVelocitySigmaMps: z.number().positive().optional(),
          rearThresholdM: z.number().positive().optional(),
        })
        .partial(),
    )
    .optional(),
});

export const trackingPipelineStatusCodeSchema = z.enum([
  "disabled",
  "running",
  "paused",
  "waiting",
  "completed",
  "failed",
  "cancelled",
]);

export const trackingPipelineStatusSchema = z.object({
  code: trackingPipelineStatusCodeSchema,
  label: z.string(),
  detail: z.string(),
  remainingCandidates: z.number().int().nonnegative().optional(),
});

export const trackingStatusResponseSchema = z.object({
  enabled: z.boolean(),
  paused: z.boolean(),
  daemonRunning: z.boolean(),
  pipelineStatus: trackingPipelineStatusSchema,
  activeRun: trackingRebuildRunSchema.nullable(),
  lastRun: trackingRebuildRunSchema.nullable(),
  watermark: trackingWatermarkSchema.nullable(),
  totalTracks: z.number().int().nonnegative(),
  totalCandidates: z.number().int().nonnegative(),
  percentApprox: z.number().min(0).max(100),
  metrics: trackingPipelineMetricsSchema,
  config: trackingPipelineConfigSchema,
});

export type TrackingPipelineMetrics = z.infer<typeof trackingPipelineMetricsSchema>;

export type TrackingRebuildStage = z.infer<typeof trackingRebuildStageSchema>;
export type TrackingWatermark = z.infer<typeof trackingWatermarkSchema>;
export type TrackingRebuildStats = z.infer<typeof trackingRebuildStatsSchema>;
export type TrackingRebuildRun = z.infer<typeof trackingRebuildRunSchema>;
export type TrackingPipelineConfig = z.infer<typeof trackingPipelineConfigSchema>;
export type TrackingPipelineStatus = z.infer<typeof trackingPipelineStatusSchema>;
export type TrackingStatusResponse = z.infer<typeof trackingStatusResponseSchema>;

export const trackingTuneRunStatusSchema = z.enum(["running", "done", "failed", "cancelled"]);

export const trackingTuneRunSchema = z.object({
  id: z.string().uuid(),
  status: trackingTuneRunStatusSchema,
  paramsIn: z.record(z.unknown()),
  epochsDone: z.number().int().nonnegative(),
  maxEpochs: z.number().int().positive(),
  bestConfig: z.record(z.unknown()).nullable(),
  bestFitness: z.number().nullable(),
  grid: z.array(z.record(z.unknown())),
  error: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
});

export const trackingTuneStartRequestSchema = z.object({
  profile: threatProfileSchema.default("uav"),
  maxEpochs: z.number().int().min(1).max(50).optional(),
  sampleLimit: z.number().int().min(100).max(5000).optional(),
});

export type TrackingTuneRun = z.infer<typeof trackingTuneRunSchema>;
export type TrackingTuneStartRequest = z.infer<typeof trackingTuneStartRequestSchema>;
