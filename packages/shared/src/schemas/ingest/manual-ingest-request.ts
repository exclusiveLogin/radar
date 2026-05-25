import { z } from "zod";

/** Тело admin POST для ручного сообщения об атаке. */
export const manualIngestRequestSchema = z.object({
  channelKey: z.string().min(1).optional(),
  bindingId: z.string().uuid().optional(),
  rawText: z.string().min(1),
  postedAt: z.string().datetime().optional(),
  meta: z.record(z.unknown()).optional(),
});

export const manualIngestResponseSchema = z.object({
  rawMessageId: z.string().uuid(),
  inserted: z.boolean(),
  parseScheduled: z.boolean(),
});

export type ManualIngestRequest = z.infer<typeof manualIngestRequestSchema>;
export type ManualIngestResponse = z.infer<typeof manualIngestResponseSchema>;
