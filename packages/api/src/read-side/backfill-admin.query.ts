import {
  backfillJobListItemSchema,
  buildBackfillJobProgress,
  resolveBackfillRoundRobinSlice,
  type BackfillJobListItem,
} from "@radar/shared";
import type { DataSource } from "typeorm";

export type BackfillAdminSqlRow = {
  id: string;
  binding_id: string;
  provider_id: string;
  strategy: string;
  params: Record<string, unknown>;
  status: string;
  stats: { inserted: number; duplicates: number; parsed: number };
  created_at: Date;
  updated_at: Date;
  channel_key: string | null;
};

const SELECT_BACKFILL_ADMIN = `
  SELECT j.id, j.binding_id, j.provider_id, j.strategy, j.params, j.status,
         j.stats, j.created_at, j.updated_at, c.key AS channel_key
  FROM job_ingest_backfill j
  LEFT JOIN ingest_bindings b ON b.id = j.binding_id
  LEFT JOIN channels c ON c.id = b.channel_id
`;

function readCheckpoint(
  params: Record<string, unknown>,
): { offsetId: string; postedAt: string } | null {
  const raw = params.checkpoint;
  if (!raw || typeof raw !== "object") return null;
  const cp = raw as { offsetId?: unknown; postedAt?: unknown };
  if (typeof cp.offsetId !== "string" || typeof cp.postedAt !== "string") return null;
  return { offsetId: cp.offsetId, postedAt: cp.postedAt };
}

/** Строка job_ingest_backfill → DTO для REST/WS админки. */
export function mapBackfillAdminRow(row: BackfillAdminSqlRow): BackfillJobListItem {
  const checkpoint = readCheckpoint(row.params);
  return backfillJobListItemSchema.parse({
    id: row.id,
    bindingId: row.binding_id,
    providerId: row.provider_id,
    strategy: row.strategy,
    params: row.params,
    status: row.status,
    stats: row.stats,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    channelKey: row.channel_key,
    progress: buildBackfillJobProgress({
      strategy: row.strategy,
      params: row.params,
      stats: row.stats,
      checkpointOffsetId: checkpoint?.offsetId ?? null,
      checkpointPostedAt: checkpoint?.postedAt ?? null,
    }),
    roundRobinSlice: resolveBackfillRoundRobinSlice(row.status, row.params),
  });
}

/** Активные backfill-задачи для WS-поллера. */
export async function listActiveBackfillJobs(
  dataSource: DataSource,
  limit: number,
): Promise<BackfillAdminSqlRow[]> {
  return dataSource.query<BackfillAdminSqlRow[]>(
    `${SELECT_BACKFILL_ADMIN}
     WHERE j.status IN ('pending', 'running')
     ORDER BY j.updated_at DESC
     LIMIT $1`,
    [limit],
  );
}

/** Карточки job по id (финальный push после completed/canceled/failed). */
export async function listBackfillJobsByIds(
  dataSource: DataSource,
  ids: string[],
): Promise<BackfillAdminSqlRow[]> {
  if (ids.length === 0) return [];
  return dataSource.query<BackfillAdminSqlRow[]>(
    `${SELECT_BACKFILL_ADMIN}
     WHERE j.id = ANY($1::uuid[])`,
    [ids],
  );
}
