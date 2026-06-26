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
  batchSize: z.number().int().nonnegative().optional(),
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
  elapsedMs: z.number().int().nonnegative().optional(),
});

/** Агрегированные метрики пайплайна для админки. */
export const trackingPipelineMetricsSchema = z.object({
  totalCandidatesGeo: z.number().int().nonnegative(),
  totalTargetCandidates: z.number().int().nonnegative(),
  processedCandidates: z.number().int().nonnegative(),
  percentProcessed: z.number().min(0).max(100),
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
  stats: trackingRebuildStatsSchema.partial(),
  checkpoint: trackingWatermarkSchema.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const trackingPipelineConfigSchema = z.object({
  batchSize: z.number().int().min(100).max(5000).default(1000),
  daemonIntervalMs: z.number().int().min(5000).max(300000).optional(),
  seedMin: z.number().min(0.1).max(1).default(0.45),
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
          rearThresholdM: z.number().positive().optional(),
        })
        .partial(),
    )
    .optional(),
});

export const trackingStatusResponseSchema = z.object({
  enabled: z.boolean(),
  paused: z.boolean(),
  daemonRunning: z.boolean(),
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
