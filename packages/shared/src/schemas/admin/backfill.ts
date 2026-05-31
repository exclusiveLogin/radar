/**
 * ---
 * layer: shared
 * kind: schema
 * domain: admin
 * tooling: zod
 * purpose: Контракты чтения/мониторинга backfill-задач для админ-панели.
 * ---
 */
import { z } from "zod";
import { backfillJobStatusSchema } from "../ingest/ingest-domain";
import { backfillJobRecordSchema } from "../ingest/ingest-timeline";

/** Прогресс задачи: счётчики + позиция чекпоинта (resume). */
export const backfillJobProgressSchema = z.object({
  inserted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  parsed: z.number().int().nonnegative(),
  checkpointOffsetId: z.string().nullable(),
  checkpointPostedAt: z.string().datetime().nullable(),
});

/** Элемент списка job: запись + канал + развёрнутый прогресс для UI. */
export const backfillJobListItemSchema = backfillJobRecordSchema.extend({
  channelKey: z.string().nullable(),
  progress: backfillJobProgressSchema,
});

/** Фильтры списка backfill-задач. */
export const backfillJobsQuerySchema = z.object({
  status: backfillJobStatusSchema.optional(),
  bindingId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export type BackfillJobProgress = z.infer<typeof backfillJobProgressSchema>;
export type BackfillJobListItem = z.infer<typeof backfillJobListItemSchema>;
export type BackfillJobsQuery = z.infer<typeof backfillJobsQuerySchema>;
