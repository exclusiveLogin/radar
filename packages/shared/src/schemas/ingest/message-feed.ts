import { z } from "zod";
import { ingestModeSchema } from "./ingest-domain";
import { stateLevelSchema } from "../geo/state-level";

/** Строка ленты сырых сообщений для дашборда (read-side). */
export const messageFeedItemSchema = z.object({
  id: z.string().uuid(),
  channelKey: z.string(),
  channelTitle: z.string().nullable().optional(),
  postedAt: z.string().datetime(),
  rawText: z.string(),
  ingestMode: ingestModeSchema,
  /** Тип события после parse (null — ещё не разобрано). */
  eventType: z.string().nullable().optional(),
  /** Семантика из parse/LLM (threat, clear, other, …). */
  eventCategory: z.string().nullable().optional(),
  /** Уровень карты из status_dictionary (null — нет parse или неизвестный код). */
  stateLevel: stateLevelSchema.nullable().optional(),
  regionCodes: z.array(z.string()).default([]),
  /** Повторное сообщение («Повторно», «Ещё раз»). */
  repeat: z.boolean().optional(),
});

export const messageFeedResponseSchema = z.object({
  items: z.array(messageFeedItemSchema),
});

export type MessageFeedItem = z.infer<typeof messageFeedItemSchema>;
export type MessageFeedResponse = z.infer<typeof messageFeedResponseSchema>;
