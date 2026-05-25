/**
 * ---
 * layer: shared
 * kind: schema
 * domain: ingest
 * tooling: zod
 * purpose: Сырые сообщения до парсинга — provider-agnostic universal model.
 * ---
 */
import { z } from "zod";
import { ingestModeSchema, sourceKindSchema } from "./ingest-domain";

export const rawMessageSchema = z.object({
  id: z.string().uuid().optional(),
  channelKey: z.string().min(1),
  providerKey: z.string().min(1),
  sourceKind: sourceKindSchema,
  externalMessageId: z.string().min(1),
  revisionKey: z.string().nullable().optional(),
  sourceSequence: z.string().nullable().optional(),
  postedAt: z.string().datetime(),
  ingestMode: ingestModeSchema.default("live"),
  rawText: z.string().min(1),
  rawPayload: z.record(z.unknown()).optional(),
  hash: z.string().min(8),
  fetchedAt: z.string().datetime().optional(),
});

/** Telegram extension sidecar — hot fields для dedup lookup. */
export const rawMessageTelegramExtensionSchema = z.object({
  rawMessageId: z.string().uuid(),
  chatId: z.string(),
  messageId: z.string(),
  editDate: z.string().datetime().nullable(),
  peerType: z.enum(["channel", "group", "supergroup", "user"]).optional(),
});

export type RawMessage = z.infer<typeof rawMessageSchema>;
export type RawMessageTelegramExtension = z.infer<typeof rawMessageTelegramExtensionSchema>;
