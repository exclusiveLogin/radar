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
  phaseDefinitionSchema,
  phaseRunSchema,
} from "@radar/shared";
import type { PhaseDefinition, PhaseRun } from "@radar/shared";
import { z } from "zod";

const channelsSchema = z.array(channelAdminItemSchema);
const backfillJobsSchema = z.array(backfillJobListItemSchema);
const parseAttemptsSchema = z.array(parseAttemptItemSchema);
const phasesSchema = z.array(phaseDefinitionSchema);
const phaseRunsSchema = z.array(phaseRunSchema);

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

  phasesRunsOverview: (): Promise<{
    runningCount: number;
    byPhase: Array<{
      phaseId: string;
      activeRun: PhaseRun | null;
      coverage: Record<string, number>;
    }>;
  }> => getJson("/api/admin/phases/runs/overview", z.any()),

  phasesRuns: (params?: { phaseId?: string; status?: string; limit?: number }): Promise<PhaseRun[]> => {
    const query = new URLSearchParams();
    if (params?.phaseId) query.set("phaseId", params.phaseId);
    if (params?.status) query.set("status", params.status);
    query.set("limit", String(params?.limit ?? 20));
    return getJson(`/api/admin/phases/runs?${query.toString()}`, phaseRunsSchema);
  },

  phasesStartRun: (phaseId: string, body: Record<string, unknown>): Promise<PhaseRun> =>
    postJson(`/api/admin/phases/${encodeURIComponent(phaseId)}/run`, body, phaseRunSchema),

  phasesCancelRun: (runId: string): Promise<{ ok: true }> =>
    postJson(`/api/admin/phases/runs/${encodeURIComponent(runId)}/cancel`, undefined, z.object({ ok: z.literal(true) })),
};
