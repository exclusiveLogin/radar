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

/** Прогресс задачи: счётчики + чекпоинт + примерный % по id-диапазону. */
export const backfillJobProgressSchema = z.object({
  inserted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  parsed: z.number().int().nonnegative(),
  checkpointOffsetId: z.string().nullable(),
  checkpointPostedAt: z.string().datetime().nullable(),
  boundsMinId: z.string().nullable(),
  boundsMaxId: z.string().nullable(),
  percentApprox: z.number().int().min(0).max(100).nullable(),
});

/** Метка round-robin slice для карточки job (active = зелёный, waiting = жёлтый). */
export const backfillRoundRobinSliceSchema = z.enum(["active", "waiting"]);

/** Элемент списка job: запись + канал + развёрнутый прогресс для UI. */
export const backfillJobListItemSchema = backfillJobRecordSchema.extend({
  channelKey: z.string().nullable(),
  progress: backfillJobProgressSchema,
  roundRobinSlice: backfillRoundRobinSliceSchema.nullable(),
});

/** Фильтры списка backfill-задач. */
export const backfillJobsQuerySchema = z.object({
  status: backfillJobStatusSchema.optional(),
  bindingId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export type BackfillJobProgress = z.infer<typeof backfillJobProgressSchema>;
export type BackfillRoundRobinSlice = z.infer<typeof backfillRoundRobinSliceSchema>;
export type BackfillJobListItem = z.infer<typeof backfillJobListItemSchema>;
export type BackfillJobsQuery = z.infer<typeof backfillJobsQuerySchema>;
