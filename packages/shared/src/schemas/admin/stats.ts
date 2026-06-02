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

const queueCountsSchema = z.object({
  pending: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

const phaseCoverageCountsSchema = queueCountsSchema.extend({
  /** done и есть parsed_events для этого raw (реальное событие на карте). */
  doneForParsed: z.number().int().nonnegative(),
});

const geoEnrichmentCountsSchema = queueCountsSchema.extend({
  /** job done и провайдер реально в places.evidence_providers. */
  doneWithEvidence: z.number().int().nonnegative(),
  /** Активные places без провайдера в evidence (ещё не обогащены). */
  catalogRemaining: z.number().int().nonnegative(),
});

export const statsOverviewSchema = z.object({
  rawTotal: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
  backfill: z.number().int().nonnegative(),
  manual: z.number().int().nonnegative(),
  parsedEvents: z.number().int().nonnegative(),
  /** Активные places в каталоге (не region) — знаменатель для geo enrichment. */
  placesCatalogActive: z.number().int().nonnegative(),
  /** Счётчики phase_coverage по фазам (catalog, llm, …). */
  phaseEnrichment: z.array(
    z.object({
      phaseId: z.string(),
      counts: phaseCoverageCountsSchema,
    }),
  ),
  /** Счётчики place_enrichment_jobs по geoParse-фазам (geo-dadata, …). */
  geoEnrichment: z.array(
    z.object({
      phaseId: z.string(),
      provider: z.enum(["dadata", "llm", "nominatim"]).nullable(),
      enabled: z.boolean(),
      counts: geoEnrichmentCountsSchema,
    }),
  ),
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
