import {
  adminTelemetrySchema,
  backfillJobListItemSchema,
  backfillJobRecordSchema,
  channelAdminItemSchema,
  channelStatsSchema,
  jobDefinitionSchema,
  jobRunSchema,
  parseAttemptItemSchema,
  statsOverviewSchema,
  type AdminTelemetry,
  type BackfillJobListItem,
  type BackfillJobRecord,
  type BackfillStrategy,
  type ChannelAdminItem,
  type ChannelStats,
  type CreateJobDefinition,
  type JobDefinition,
  type JobRun,
  type ParseAttemptItem,
  type StatsOverview,
  type UpdateJobDefinition,
} from "@radar/shared";
import { z } from "zod";

const channelsSchema = z.array(channelAdminItemSchema);
const backfillJobsSchema = z.array(backfillJobListItemSchema);
const parseAttemptsSchema = z.array(parseAttemptItemSchema);
const jobDefinitionsSchema = z.array(jobDefinitionSchema);
const jobRunsSchema = z.array(jobRunSchema);

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

  // ─── Планировщик задач (ADR-003, Фаза G) ────────────────────────────────
  jobDefinitions: (): Promise<JobDefinition[]> =>
    getJson("/api/admin/jobs/definitions", jobDefinitionsSchema),

  createJobDefinition: (input: CreateJobDefinition): Promise<JobDefinition> =>
    postJson("/api/admin/jobs/definitions", input, jobDefinitionSchema),

  updateJobDefinition: (id: string, patch: UpdateJobDefinition): Promise<JobDefinition> =>
    sendJson("PATCH", `/api/admin/jobs/definitions/${encodeURIComponent(id)}`, patch, jobDefinitionSchema),

  triggerJob: (id: string): Promise<JobRun> =>
    postJson(`/api/admin/jobs/definitions/${encodeURIComponent(id)}/trigger`, undefined, jobRunSchema),

  jobRuns: (params?: { definitionId?: string; limit?: number }): Promise<JobRun[]> => {
    const query = new URLSearchParams();
    if (params?.definitionId) query.set("definitionId", params.definitionId);
    query.set("limit", String(params?.limit ?? 20));
    return getJson(`/api/admin/jobs/runs?${query.toString()}`, jobRunsSchema);
  },
};
