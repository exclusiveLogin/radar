import {
  adminTelemetrySchema,
  backfillJobListItemSchema,
  backfillJobRecordSchema,
  channelAdminItemSchema,
  channelStatsSchema,
  parseAttemptItemSchema,
  statsOverviewSchema,
  type AdminTelemetry,
  type BackfillJobListItem,
  type BackfillJobRecord,
  type BackfillStrategy,
  type ChannelAdminItem,
  type ChannelStats,
  type ParseAttemptItem,
  type StatsOverview,
  parsePipelineStartResponseSchema,
  parsePipelineStatusResponseSchema,
  type ParsePipelineStartResponse,
  type ParsePipelineStatusResponse,
  phaseDefinitionSchema,
  phaseRunsOverviewSchema,
  type PhaseRunsOverview,
  phaseRunSchema,
  trackingStatusResponseSchema,
  trackingRebuildRunSchema,
  trackingPipelineConfigSchema,
  type TrackingPipelineConfig,
  workbookObservabilityResponseSchema,
  type WorkbookObservabilityResponse,
} from "@radar/shared";
import type { PhaseDefinition, PhaseRun, TrackingStatusResponse, TrackingRebuildRun } from "@radar/shared";
import { z } from "zod";

const channelsSchema = z.array(channelAdminItemSchema);
const backfillJobsSchema = z.array(backfillJobListItemSchema);
const parseAttemptsSchema = z.array(parseAttemptItemSchema);
const phasesSchema = z.array(phaseDefinitionSchema);
const phaseRunsSchema = z.array(phaseRunSchema);
const trackingRunsSchema = z.array(trackingRebuildRunSchema);

async function getJson<T>(url: string, schema: { parse: (data: unknown) => T }): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`);
  return schema.parse((await response.json()) as unknown);
}

async function postJson<T>(
  url: string,
  body: unknown,
  schema: { parse: (data: unknown) => T },
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`);
  return schema.parse((await response.json()) as unknown);
}

async function sendJson<T>(
  method: "PATCH" | "DELETE",
  url: string,
  body: unknown,
  schema: { parse: (data: unknown) => T },
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`);
  return schema.parse((await response.json()) as unknown);
}

/** Параметры создания backfill-задачи (форма раннера). */
export type CreateBackfillInput = {
  bindingId: string;
  strategy: BackfillStrategy;
  params?: {
    fromPostedAt?: string;
    toPostedAt?: string;
    fromExternalId?: string;
    toExternalId?: string;
    batchSize?: number;
  };
};

/** Тонкий REST-клиент админки: ответы валидируются zod-контрактами @radar/shared. */
export const adminApi = {
  channels: (): Promise<ChannelAdminItem[]> =>
    getJson("/api/admin/ingest/channels", channelsSchema),

  channelStats: (channelKey: string): Promise<ChannelStats> =>
    getJson(
      `/api/admin/ingest/channels/${encodeURIComponent(channelKey)}/stats`,
      channelStatsSchema,
    ),

  backfillJobs: (params?: { status?: string; bindingId?: string; limit?: number }): Promise<
    BackfillJobListItem[]
  > => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.bindingId) query.set("bindingId", params.bindingId);
    if (params?.limit) query.set("limit", String(params.limit));
    const qs = query.toString();
    return getJson(`/api/admin/ingest/backfill-jobs${qs ? `?${qs}` : ""}`, backfillJobsSchema);
  },

  createBackfillJob: (input: CreateBackfillInput): Promise<BackfillJobRecord> =>
    postJson(
      "/api/admin/ingest/backfill-jobs",
      { bindingId: input.bindingId, strategy: input.strategy, params: input.params ?? {} },
      backfillJobRecordSchema,
    ),

  cancelBackfillJob: (id: string): Promise<BackfillJobListItem> =>
    postJson(
      `/api/admin/ingest/backfill-jobs/${encodeURIComponent(id)}/cancel`,
      undefined,
      backfillJobListItemSchema,
    ),

  telemetry: (): Promise<AdminTelemetry> =>
    getJson("/api/admin/telemetry", adminTelemetrySchema),

  statsOverview: (): Promise<StatsOverview> =>
    getJson("/api/admin/stats/overview", statsOverviewSchema),

  parseAttempts: (params?: {
    status?: string;
    channelKey?: string;
    limit?: number;
  }): Promise<ParseAttemptItem[]> => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.channelKey) query.set("channelKey", params.channelKey);
    query.set("limit", String(params?.limit ?? 100));
    return getJson(`/api/admin/parse-attempts?${query.toString()}`, parseAttemptsSchema);
  },

  // ─── Phase-pipeline v2 ───────────────────────────────────────────────────
  phasesList: (): Promise<PhaseDefinition[]> =>
    getJson("/api/admin/phases", phasesSchema),

  phasesPatch: (id: string, patch: Record<string, unknown>): Promise<PhaseDefinition> =>
    sendJson("PATCH", `/api/admin/phases/${encodeURIComponent(id)}`, patch, phaseDefinitionSchema),

  phasesRunsOverview: (): Promise<PhaseRunsOverview> =>
    getJson("/api/admin/phases/runs/overview", phaseRunsOverviewSchema),

  phasesRuns: (params?: { phaseId?: string; status?: string; limit?: number }): Promise<PhaseRun[]> => {
    const query = new URLSearchParams();
    if (params?.phaseId) query.set("phaseId", params.phaseId);
    if (params?.status) query.set("status", params.status);
    query.set("limit", String(params?.limit ?? 20));
    return getJson(`/api/admin/phases/runs?${query.toString()}`, phaseRunsSchema);
  },

  phasesStartRun: (phaseId: string, body: Record<string, unknown>): Promise<PhaseRun> =>
    postJson(`/api/admin/phases/${encodeURIComponent(phaseId)}/run`, body, phaseRunSchema),

  phasesClearQueue: (phaseId: string): Promise<{ ok: true; cleared: number; runsCanceled: number }> =>
    postJson(
      `/api/admin/phases/${encodeURIComponent(phaseId)}/clear-queue`,
      undefined,
      z.object({
        ok: z.literal(true),
        cleared: z.number().int().nonnegative(),
        runsCanceled: z.number().int().nonnegative(),
      }),
    ),

  phasesResetFailed: (phaseId: string): Promise<{ ok: true; reset: number }> =>
    postJson(
      `/api/admin/phases/${encodeURIComponent(phaseId)}/reset-failed`,
      undefined,
      z.object({ ok: z.literal(true), reset: z.number().int().nonnegative() }),
    ),

  phasesCancelRun: (runId: string): Promise<{ ok: true }> =>
    postJson(`/api/admin/phases/runs/${encodeURIComponent(runId)}/cancel`, undefined, z.object({ ok: z.literal(true) })),

  /** Как CLI phase:runs:stop-all — cancel runs + DELETE pending/processing в phase_coverage. */
  phasesStopAllRuns: (): Promise<{
    ok: true;
    phaseRunsClosed: number;
    queueCleared: number;
    geoJobsCleared: number;
    processingReleased: number;
  }> =>
    postJson(
      "/api/admin/phases/runs/stop-all",
      undefined,
      z.object({
        ok: z.literal(true),
        phaseRunsClosed: z.number().int().nonnegative(),
        queueCleared: z.number().int().nonnegative(),
        geoJobsCleared: z.number().int().nonnegative(),
        processingReleased: z.number().int().nonnegative(),
      }),
    ),

  trackingGetStatus: (): Promise<TrackingStatusResponse> =>
    getJson("/api/admin/tracking/status", trackingStatusResponseSchema),

  trackingGetRuns: (limit = 20): Promise<TrackingRebuildRun[]> =>
    getJson(`/api/admin/tracking/runs?limit=${limit}`, trackingRunsSchema),

  trackingPatchEnabled: (enabled: boolean): Promise<{ ok: true; enabled: boolean }> =>
    sendJson("PATCH", "/api/admin/tracking/enabled", { enabled }, z.object({ ok: z.literal(true), enabled: z.boolean() })),

  trackingPatchConfig: (patch: Partial<TrackingPipelineConfig>): Promise<TrackingPipelineConfig> =>
    sendJson("PATCH", "/api/admin/tracking/config", patch, trackingPipelineConfigSchema),

  trackingRebuild: (): Promise<{ ok: true; runId: string }> =>
    postJson("/api/admin/tracking/rebuild", undefined, z.object({ ok: z.literal(true), runId: z.string().uuid() })),

  trackingSoftRebuild: (): Promise<{ ok: true; runId: string }> =>
    postJson(
      "/api/admin/tracking/soft-rebuild",
      undefined,
      z.object({ ok: z.literal(true), runId: z.string().uuid() }),
    ),

  trackingReset: (): Promise<{ ok: true }> =>
    postJson("/api/admin/tracking/reset", undefined, z.object({ ok: z.literal(true) })),

  trackingPause: (): Promise<{ ok: true }> =>
    postJson("/api/admin/tracking/pause", undefined, z.object({ ok: z.literal(true) })),

  trackingResume: (): Promise<{ ok: true }> =>
    postJson("/api/admin/tracking/resume", undefined, z.object({ ok: z.literal(true) })),

  trackingCancel: (): Promise<{ ok: true }> =>
    postJson("/api/admin/tracking/cancel", undefined, z.object({ ok: z.literal(true) })),

  parsePipelineGetStatus: (): Promise<ParsePipelineStatusResponse> =>
    getJson("/api/admin/parse/status", parsePipelineStatusResponseSchema),

  parsePipelineReset: (): Promise<ParsePipelineStartResponse> =>
    postJson("/api/admin/parse/reset", undefined, parsePipelineStartResponseSchema),

  parsePipelineReparse: (): Promise<ParsePipelineStartResponse> =>
    postJson("/api/admin/parse/reparse", undefined, parsePipelineStartResponseSchema),

  workbookObservability: (): Promise<WorkbookObservabilityResponse> =>
    getJson("/api/admin/workbook/observability", workbookObservabilityResponseSchema),
};
