/**
 * ---
 * layer: shared
 * kind: schema
 * domain: admin
 * tooling: zod
 * purpose: Глобальные агрегаты для админ-дашборда (сообщения, парсинг, каналы, job'ы).
 * ---
 */
import { z } from "zod";

export const statsOverviewSchema = z.object({
  rawTotal: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
  backfill: z.number().int().nonnegative(),
  manual: z.number().int().nonnegative(),
  parsedEvents: z.number().int().nonnegative(),
  parseOk: z.number().int().nonnegative(),
  parseFailed: z.number().int().nonnegative(),
  parseSkipped: z.number().int().nonnegative(),
  channelsTotal: z.number().int().nonnegative(),
  channelsListening: z.number().int().nonnegative(),
  providersTotal: z.number().int().nonnegative(),
  providersActive: z.number().int().nonnegative(),
  backfillJobs: z.object({
    pending: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    canceled: z.number().int().nonnegative(),
  }),
  lastRawPostedAt: z.string().datetime().nullable(),
});

export type StatsOverview = z.infer<typeof statsOverviewSchema>;
