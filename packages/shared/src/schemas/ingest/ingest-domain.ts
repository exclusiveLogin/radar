/**
 * Глоссарий домена Ingest Acquisition: ключи агрегатов и enum-константы.
 * @see ../../../../../docs/domain/contexts/ingest.md
 * @see ../../../../../docs/ingest-providers.md
 */
import { z } from "zod";

export const ingestAdapterKindSchema = z.enum(["telegram", "manual", "webhook", "rss"]);
export const providerStatusSchema = z.enum(["draft", "active", "paused", "error"]);
export const ingestModeSchema = z.enum(["live", "backfill", "manual"]);
export const sourceKindSchema = z.enum(["telegram", "manual", "webhook", "rss"]);

export const bindingModeSchema = z.enum([
  "user_mtproto_group",
  "user_mtproto_channel",
  "bot_api_group",
  "bot_api_dm",
  "hybrid_user_bot_group",
]);

export const backfillStrategySchema = z.enum([
  "by_date_range",
  "by_external_id_range",
  "full_history",
  /** Алиас пресета full_history (admin/скрипты). */
  "all",
]);

export const backfillJobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  /** Запрошена отмена оператором: демон не подхватывает и прерывает стрим. */
  "canceled",
]);

export type IngestAdapterKind = z.infer<typeof ingestAdapterKindSchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type IngestMode = z.infer<typeof ingestModeSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type BindingMode = z.infer<typeof bindingModeSchema>;
export type BackfillStrategy = z.infer<typeof backfillStrategySchema>;
export type BackfillJobStatus = z.infer<typeof backfillJobStatusSchema>;
