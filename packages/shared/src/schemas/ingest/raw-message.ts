/**
 * ---
 * layer: shared
 * kind: schema
 * domain: ingest
 * tooling: zod
 * purpose: Сырые сообщения Telegram до парсинга и классификации.
 * ---
 */
import { z } from "zod";

export const rawMessageSchema = z.object({
  channelKey: z.string().min(1),
  telegramMessageId: z.number().int().nonnegative(),
  hash: z.string().min(8),
  postedAt: z.string().datetime(),
  rawText: z.string().min(1),
  editDate: z.string().datetime().optional(),
});

export type RawMessage = z.infer<typeof rawMessageSchema>;
