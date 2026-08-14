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
import { DEFAULT_TRACKING_STROBE_MAX_WINDOW_MS } from "../../domain/tracking/strobePolicy";

export const trackingStepIdSchema = z.enum([
  "cluster",
  "filter",
  "field_train",
  "join",
  "optimize",
]);

export const trackingRebuildStageSchema = z.enum([
  "idle",
  "loading",
  "cluster",
  "join",
  "persisting",
  "done",
]);

export const trackingWatermarkSchema = z.object({
  lastOccurredAt: z.string().datetime(),
  lastEventLocationId: z.string().uuid(),
});

/** cluster: сколько кандидатов вошло / сколько узлов сформировал ST-DBSCAN. */
export const trackingClusterStepStatsSchema = z.object({
  candidatesIn: z.number().int().nonnegative(),
  nodesOut: z.number().int().nonnegative(),
});

/** field_train: обучение H3-поля на парах узлов (Ф2 NextGen). */
export const trackingFieldTrainStepStatsSchema = z.object({
  pairsConsidered: z.number().int().nonnegative(),
  pairsAccepted: z.number().int().nonnegative(),
  pairsRejectedByKinematics: z.number().int().nonnegative(),
  reliabilityAvg: z.number().min(0).max(1),
  reliabilityP95: z.number().min(0).max(1),
});

/** join: хронологическая сборка треков по Kalman-локусу + H3-гравитации (Ф3 NextGen). */
export const trackingJoinStepStatsSchema = z.object({
  linksConsidered: z.number().int().nonnegative(),
  linksAccepted: z.number().int().nonnegative(),
  nodesSeeded: z.number().int().nonnegative(),
  tracksOpen: z.number().int().nonnegative(),
  tracksClosed: z.number().int().nonnegative(),
  nodesAdded: z.number().int().nonnegative(),
  rejectGap: z.number().int().nonnegative(),
  rejectDistance: z.number().int().nonnegative(),
  rejectVelocity: z.number().int().nonnegative(),
  rejectCounterFlow: z.number().int().nonnegative(),
  rejectTurn: z.number().int().nonnegative(),
  rejectKalmanInnovation: z.number().int().nonnegative(),
});

/** Разбивка статистики run/тика по steps NextGen (filter/optimize — без stats, identity passthrough). */
export const trackingStepStatsSchema = z.object({
  cluster: trackingClusterStepStatsSchema.optional(),
  field_train: trackingFieldTrainStepStatsSchema.optional(),
  join: trackingJoinStepStatsSchema.optional(),
});

export const trackingRebuildStatsObjectSchema = z.object({
  stage: trackingRebuildStageSchema,
  /** Размер тика daemon (сколько pending assign за проход). Candidate window — глобальный. */
  batchSize: z.number().int().nonnegative().optional(),
  /** Точек в pending-очереди тика. */
  pendingCandidates: z.number().int().nonnegative().optional(),
  /** Размер candidate window (pending + consumed якоря). */
  candidateWindowSize: z.number().int().nonnegative().optional(),
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
  step2PairsConsidered: z.number().int().nonnegative().optional(),
  /** Ф2 NextGen: сколько пар прошло векторацию и попало в поле. */
  step2PairsAccepted: z.number().int().nonnegative().optional(),
  /** Ф2 NextGen: сколько пар отклонено кинематическим коррелятором. */
  step2PairsRejectedByKinematics: z.number().int().nonnegative().optional(),
  /** Ф2 NextGen: средняя достоверность принятых пар (0..1). */
  step2ReliabilityAvg: z.number().min(0).max(1).optional(),
  /** Ф2 NextGen: P95 достоверности принятых пар (0..1). */
  step2ReliabilityP95: z.number().min(0).max(1).optional(),
  /** Ф3 NextGen: сколько candidate→track линков оценено. */
  step3LinksConsidered: z.number().int().nonnegative().optional(),
  /** Ф3 NextGen: сколько линков принято и привело к append ноды. */
  step3LinksAccepted: z.number().int().nonnegative().optional(),
  /** Ф3 NextGen: сколько нод засеяно новым треком (не нашли валидный link). */
  step3NodesSeeded: z.number().int().nonnegative().optional(),
  /** Ф3 NextGen reject-диагностика по причинам. */
  step3RejectGap: z.number().int().nonnegative().optional(),
  step3RejectDistance: z.number().int().nonnegative().optional(),
  step3RejectVelocity: z.number().int().nonnegative().optional(),
  step3RejectCounterFlow: z.number().int().nonnegative().optional(),
  step3RejectTurn: z.number().int().nonnegative().optional(),
  step3RejectKalmanInnovation: z.number().int().nonnegative().optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
  /** Статистика по NextGen step-constructor pipeline (SSOT для UI-блоков по фазам). */
  stepStats: trackingStepStatsSchema.optional(),
});

/** SSOT-схема stats run/тика. Rename ключей — только через SQL-миграцию. */
export const trackingRebuildStatsSchema = trackingRebuildStatsObjectSchema;

/** Агрегированные метрики пайплайна для админки. */
export const trackingPipelineMetricsSchema = z.object({
  totalCandidatesGeo: z.number().int().nonnegative(),
  totalTargetCandidates: z.number().int().nonnegative(),
  /** Очередь: ещё не прошли пайплайн. */
  unconsumedPipeline: z.number().int().nonnegative(),
  /** Размер candidate window (pending + consumed-якоря) — live для админки. */
  candidateWindowSize: z.number().int().nonnegative().optional(),
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
  mode: z.enum(["incremental", "full_rebuild"]),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  since: z.string().datetime(),
  until: z.string().datetime(),
  rebuildGen: z.string(),
  stats: trackingRebuildStatsObjectSchema.partial(),
  checkpoint: trackingWatermarkSchema.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const trackingPipelineConfigSchema = z.object({
  /** Точек, читаемых и назначаемых за один bounded tick. */
  batchSize: z.number().int().min(10).max(20000).default(500),
  /**
   * Шаг сетки event-time бинов: binStart = floor(t / maxWindowMs) * maxWindowMs.
   * ε ST-DBSCAN определяет соседство внутри бина; бин запрещает бесконечную транзитивную цепочку.
   */
  strobe: z.object({
    maxWindowMs: z.number().int().min(60_000).max(24 * 60 * 60 * 1000)
      .default(DEFAULT_TRACKING_STROBE_MAX_WINDOW_MS),
  }).default({}),
  daemonIntervalMs: z.number().int().min(5000).max(300000).optional(),
  /** Зарезервировано: порог seedScore. NextGen join пока сидит любую ноду без link. */
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
  /** Режим ST-DBSCAN: collapse (legacy) или magnet (веса без схлопывания). */
  clusteringMode: z.enum(["collapse", "magnet"]).default("collapse"),
  /** Параметры 4-х фазного алгоритма NextGen Gravity. */
  nextgen: z
    .object({
      /** Разрешение H3 сетки для глобального векторного поля. */
      h3Resolution: z.number().int().min(4).max(12).default(8),
      /** Зарезервировано: порог массы центра гравитации (фаза не подключена). */
      gravityCenterMassThreshold: z.number().min(0).default(5),
      /**
       * Зарезервировано: отдельный χ² локуса.
       * Runtime gate использует profiles.*.chi2Threshold.
       */
      kalmanLocusChi2Threshold: z.number().min(0).default(5.99),
      /** Мин. число нод, чтобы цепочка стала сплошной магистралью (иначе — пунктир-сателлит). */
      minBackboneNodes: z.number().int().min(2).max(10).default(3),
      /** Сила штрафа за поворот трассы (множитель стоимости при развороте 180°; 0 = выкл). */
      turnPenaltyWeight: z.number().min(0).max(10).default(3),
      /** Жёсткий запрет поворота круче этого (град): шаг назад по курсу = разрыв трассы. */
      maxTurnDeg: z.number().min(0).max(180).default(135),
      /** Зарезервировано: Reverse Forward Loop (фаза 4 не реализована). */
      rflEnabled: z.boolean().default(true),
      /**
       * Мягкий порог cos для Phase2 (ниже — отрезок не строится).
       * По умолчанию = counterFlowRejectCos из корня конфига.
       */
      rflPenaltyThreshold: z.number().min(-1).max(1).optional(),
    })
    .default({}),
  /**
   * Параметры магнитной фазы. Активны только при clusteringMode=magnet;
   * в collapse (default) не влияют на join.
   */
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

/** Состав steps NextGen pipeline (id + enabled) — источник для step-блоков в admin UI. */
export const trackingStepManifestEntrySchema = z.object({
  id: trackingStepIdSchema,
  enabled: z.boolean(),
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
  /** Сохранённые параметры отличаются от revision, которым построен текущий state. */
  rebuildRequired: z.boolean().default(false),
  /** Состав steps pipeline (SSOT: @radar/shared DEFAULT_TRACKING_STEP_MANIFEST). */
  stepManifest: z.array(trackingStepManifestEntrySchema),
});

export type TrackingPipelineMetrics = z.infer<typeof trackingPipelineMetricsSchema>;

export type TrackingRebuildStage = z.infer<typeof trackingRebuildStageSchema>;
export type TrackingWatermark = z.infer<typeof trackingWatermarkSchema>;
export type TrackingClusterStepStats = z.infer<typeof trackingClusterStepStatsSchema>;
export type TrackingFieldTrainStepStats = z.infer<typeof trackingFieldTrainStepStatsSchema>;
export type TrackingJoinStepStats = z.infer<typeof trackingJoinStepStatsSchema>;
export type TrackingStepStats = z.infer<typeof trackingStepStatsSchema>;
export type TrackingRebuildStats = z.infer<typeof trackingRebuildStatsSchema>;
export type TrackingRebuildRun = z.infer<typeof trackingRebuildRunSchema>;
export type TrackingPipelineConfig = z.infer<typeof trackingPipelineConfigSchema>;
export type TrackingPipelineStatus = z.infer<typeof trackingPipelineStatusSchema>;
export type TrackingStatusResponse = z.infer<typeof trackingStatusResponseSchema>;
