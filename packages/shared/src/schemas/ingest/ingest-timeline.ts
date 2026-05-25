import { z } from "zod";
import { backfillJobStatusSchema, backfillStrategySchema } from "./ingest-domain";
import { rawMessageSchema } from "./raw-message";

/** Ключ сортировки timeline: UTC postedAt + tie-breaker. */
export const timelineOrderingKeySchema = z.object({
  postedAtUtc: z.string().datetime(),
  tieBreaker: z.string().min(1),
});

export const timelineAnchorSchema = z.object({
  channelKey: z.string().min(1),
  postedAtUtc: z.string().datetime(),
  tieBreaker: z.string().min(1),
  direction: z.enum(["before", "after"]),
  limit: z.number().int().positive().max(200),
});

export const timelineQuerySchema = z.object({
  channelKey: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  order: z.enum(["asc", "desc"]).default("desc"),
  anchorPostedAt: z.string().datetime().optional(),
  anchorTieBreaker: z.string().min(1).optional(),
  direction: z.enum(["before", "after"]).optional(),
});

export const fetchHistoryBatchSchema = z.object({
  fromPostedAt: z.string().datetime().optional(),
  toPostedAt: z.string().datetime().optional(),
  fromExternalId: z.string().optional(),
  toExternalId: z.string().optional(),
  batchSize: z.number().int().positive().default(200),
});

export const createBackfillJobSchema = z.object({
  bindingId: z.string().uuid(),
  strategy: backfillStrategySchema,
  params: fetchHistoryBatchSchema.default({}),
});

export const backfillJobRecordSchema = z.object({
  id: z.string().uuid(),
  bindingId: z.string().uuid(),
  providerId: z.string().uuid(),
  strategy: backfillStrategySchema,
  params: z.record(z.unknown()),
  status: backfillJobStatusSchema,
  stats: z
    .object({
      inserted: z.number().int().nonnegative().default(0),
      duplicates: z.number().int().nonnegative().default(0),
      parsed: z.number().int().nonnegative().default(0),
    })
    .default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const timelineResponseSchema = z.object({
  items: z.array(rawMessageSchema),
  nextAnchor: timelineAnchorSchema.nullable(),
});

export type TimelineOrderingKey = z.infer<typeof timelineOrderingKeySchema>;
export type TimelineAnchor = z.infer<typeof timelineAnchorSchema>;
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export type CreateBackfillJob = z.infer<typeof createBackfillJobSchema>;
export type BackfillJobRecord = z.infer<typeof backfillJobRecordSchema>;
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;
