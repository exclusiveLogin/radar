import { z } from "zod";
import { ingestModeSchema } from "./ingest-domain";
import { stateLevelSchema } from "../geo/state-level";

export const contentKindSchema = z.enum(["event", "noise", "meta"]);

/** Строка ленты сырых сообщений для дашборда (read-side). */
export const messageFeedItemSchema = z.object({
  id: z.string().uuid(),
  channelKey: z.string(),
  channelTitle: z.string().nullable().optional(),
  postedAt: z.string().datetime(),
  rawText: z.string(),
  ingestMode: ingestModeSchema,
  /** Эвристика groom/noise — для бейджа в UI даже без parse. */
  contentKind: contentKindSchema,
  /** Число active mat_parse_event (0 = не разобрано / noise skip). */
  parsedEventCount: z.number().int().nonnegative().default(0),
  /** Есть хотя бы одна строка mat_parse_location. */
  hasLocations: z.boolean().default(false),
  /** Тип события после parse (null — ещё не разобрано). */
  eventType: z.string().nullable().optional(),
  /** Семантика из parse/LLM (threat, clear, other, …). */
  eventCategory: z.string().nullable().optional(),
  /** Уровень карты из status_dictionary (null — нет parse или неизвестный код). */
  stateLevel: stateLevelSchema.nullable().optional(),
  regionCodes: z.array(z.string()).default([]),
  /** Повторное сообщение («Повторно», «Ещё раз»). */
  repeat: z.boolean().optional(),
  /** Неподтверждённый сигнал («возможно», «вероятно»). */
  uncertain: z.boolean().optional(),
  /** Множественная фиксация (multiple-processor). */
  multiple: z.boolean().optional(),
  /** Массовость (trait mass). */
  mass: z.boolean().optional(),
});

export const messageFeedResponseSchema = z.object({
  items: z.array(messageFeedItemSchema),
});

export type MessageFeedItem = z.infer<typeof messageFeedItemSchema>;
export type MessageFeedResponse = z.infer<typeof messageFeedResponseSchema>;
