import { z } from "zod";
import { stateLevelSchema } from "../geo/state-level";

/** Одно разобранное событие для ленты изменений (1 parsed_event ← 1 raw). */
export const stateChangeEventItemSchema = z.object({
  parsedEventId: z.string().uuid(),
  rawMessageId: z.string().uuid(),
  channelKey: z.string(),
  channelTitle: z.string().nullable().optional(),
  postedAt: z.string().datetime(),
  rawText: z.string(),
  /** Текст без promo/footer канала — для tooltip карты. */
  displayText: z.string().optional(),
  eventType: z.string().optional(),
  eventCategory: z.string().nullable().optional(),
  stateLevel: stateLevelSchema,
  regionCodes: z.array(z.string()).min(1),
  regionNames: z.array(z.string()).default([]),
  /** Повторное сообщение («Повторно», «Ещё раз»). */
  repeat: z.boolean().optional(),
});

export const stateChangeEventsResponseSchema = z.object({
  items: z.array(stateChangeEventItemSchema),
});

export type StateChangeEventItem = z.infer<typeof stateChangeEventItemSchema>;
export type StateChangeEventsResponse = z.infer<typeof stateChangeEventsResponseSchema>;
