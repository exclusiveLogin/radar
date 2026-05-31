/**
 * ---
 * layer: shared
 * kind: schema
 * domain: admin
 * tooling: zod
 * purpose: Контракты списка каналов со статусом «слушается» и агрегатов по каналу.
 * ---
 */
import { z } from "zod";
import { providerStatusSchema } from "../ingest/ingest-domain";

/**
 * Канал для админки: метаданные + признак «слушается».
 * `listening` — производное: provider.active && binding.enabled && channel.enabled.
 */
export const channelAdminItemSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  title: z.string().nullable(),
  telegramTarget: z.string(),
  enabled: z.boolean(),
  sourceKind: z.string(),
  providerId: z.string().uuid().nullable(),
  bindingId: z.string().uuid().nullable(),
  providerStatus: providerStatusSchema.nullable(),
  bindingEnabled: z.boolean().nullable(),
  listening: z.boolean(),
  lastRawPostedAt: z.string().datetime().nullable(),
});

/** Агрегаты сообщений/парсинга по одному каналу. */
export const channelStatsSchema = z.object({
  channelKey: z.string(),
  rawTotal: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
  backfill: z.number().int().nonnegative(),
  manual: z.number().int().nonnegative(),
  parsedOk: z.number().int().nonnegative(),
  parseFailed: z.number().int().nonnegative(),
  parseSkipped: z.number().int().nonnegative(),
  lastPostedAt: z.string().datetime().nullable(),
});

export type ChannelAdminItem = z.infer<typeof channelAdminItemSchema>;
export type ChannelStats = z.infer<typeof channelStatsSchema>;
