/**
 * ---
 * layer: shared
 * kind: schema
 * domain: admin
 * tooling: zod
 * purpose: Контракт строки parse_attempts для лога парсинга в админке/realtime.
 * ---
 */
import { z } from "zod";

export const parseAttemptStatusSchema = z.enum(["ok", "failed", "skipped"]);

export const parseAttemptItemSchema = z.object({
  id: z.string().uuid(),
  rawMessageId: z.string().uuid(),
  channelKey: z.string().nullable(),
  parserVersion: z.string(),
  status: parseAttemptStatusSchema,
  errors: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});

export type ParseAttemptStatus = z.infer<typeof parseAttemptStatusSchema>;
export type ParseAttemptItem = z.infer<typeof parseAttemptItemSchema>;
