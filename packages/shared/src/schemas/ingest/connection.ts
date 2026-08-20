/**
 * Live-состояние MTProto/Telegram-соединения ingest (runtime worker probe, не БД).
 */
import { z } from "zod";

/** Фаза TCP/MTProto-сессии провайдера в worker. */
export const ingestConnectionPhaseSchema = z.enum([
  "idle",
  "connecting",
  "connected",
  "live",
  "reconnecting",
  "disconnected",
  "error",
]);

export const ingestProviderConnectionSnapshotSchema = z.object({
  providerId: z.string().uuid(),
  providerKey: z.string(),
  phase: ingestConnectionPhaseSchema,
  detail: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export type IngestConnectionPhase = z.infer<typeof ingestConnectionPhaseSchema>;
export type IngestProviderConnectionSnapshot = z.infer<
  typeof ingestProviderConnectionSnapshotSchema
>;
