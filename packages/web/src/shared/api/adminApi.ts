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
} from "@radar/shared";
import { z } from "zod";

const channelsSchema = z.array(channelAdminItemSchema);
const backfillJobsSchema = z.array(backfillJobListItemSchema);
const parseAttemptsSchema = z.array(parseAttemptItemSchema);

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
};
