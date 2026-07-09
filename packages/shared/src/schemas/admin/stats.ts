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
  /** done и есть mat_parse_event для этого raw (реальное событие на карте). */
  doneForParsed: z.number().int().nonnegative(),
});

const geoEnrichmentCountsSchema = queueCountsSchema.extend({
  /** job done и coords на place (geo enrich закрыт). */
  doneWithEvidence: z.number().int().nonnegative(),
  /** Активные places без coords — eligible для drain. */
  catalogRemaining: z.number().int().nonnegative(),
});

export const statsOverviewSchema = z.object({
  rawTotal: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
  backfill: z.number().int().nonnegative(),
  manual: z.number().int().nonnegative(),
  /** Строк mat_parse_event с is_active — может быть >1 на один raw. */
  parsedEvents: z.number().int().nonnegative(),
  /** DISTINCT raw_message_id с active parsed_event — знаменатель для done★. */
  parsedEventsActiveRaws: z.number().int().nonnegative(),
  /** Активные places в каталоге (не region) — знаменатель для geo enrichment. */
  placesCatalogActive: z.number().int().nonnegative(),
  /** Счётчики queue_parse_coverage по фазам (catalog, llm, …). */
  phaseEnrichment: z.array(
    z.object({
      phaseId: z.string(),
      counts: phaseCoverageCountsSchema,
    }),
  ),
  /** Счётчики job_geo_place_enrich по geoParse-фазам (geo-dadata, …). */
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
export type GeoEnrichmentCounts = StatsOverview["geoEnrichment"][number]["counts"];
export type PhaseCoverageCounts = StatsOverview["phaseEnrichment"][number]["counts"];
