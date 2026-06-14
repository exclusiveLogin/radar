/**
 * Контракт read-side теплокарты событий (GeoJSON + meta).
 */
import { z } from "zod";
import { stateLevelSchema } from "../geo/state-level";
import { eventTypeSchema } from "../ingest/event-type";

/** Пресет окна выборки для heatmap. */
export const eventHeatmapPeriodSchema = z.enum(["24h", "7d", "30d", "all"]);

export type EventHeatmapPeriod = z.infer<typeof eventHeatmapPeriodSchema>;

/** Типы, доступные в UI-фильтре heatmap (минимальный набор). */
export const EVENT_HEATMAP_FILTER_TYPES = [
  "fixation",
  "pvo_work",
  "intercept",
  "attention",
  "mass_warning",
] as const;

export type EventHeatmapFilterType = (typeof EVENT_HEATMAP_FILTER_TYPES)[number];

/** Короткие подписи кнопок и полные tooltip-описания. */
export const EVENT_HEATMAP_TYPE_LABELS: Record<
  EventHeatmapFilterType,
  { short: string; title: string }
> = {
  fixation: { short: "фикс", title: "Фиксация объекта / события" },
  pvo_work: { short: "ПВО", title: "Работа ПВО" },
  intercept: { short: "сбит", title: "Сбитие" },
  attention: { short: "вним", title: "Внимание" },
  mass_warning: { short: "трев", title: "Тревога" },
};

export const eventHeatmapMetaSchema = z.object({
  period: eventHeatmapPeriodSchema,
  since: z.string().datetime().nullable(),
  until: z.string().datetime(),
  count: z.number().int().nonnegative(),
  /** null — без фильтра (все типы); иначе применённый фильтр. */
  eventTypes: z.array(eventTypeSchema).nullable(),
});

export type EventHeatmapMeta = z.infer<typeof eventHeatmapMetaSchema>;

const heatmapPointFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z.object({
    weight: z.number().nonnegative(),
    stateLevel: stateLevelSchema,
    occurredAt: z.string().datetime(),
  }),
});

export const eventHeatmapResponseSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(heatmapPointFeatureSchema),
  meta: eventHeatmapMetaSchema,
});

export type EventHeatmapResponse = z.infer<typeof eventHeatmapResponseSchema>;

/** Длительность пресета в ms (all — null). */
export function eventHeatmapPeriodMs(period: EventHeatmapPeriod): number | null {
  switch (period) {
    case "24h":
      return 24 * 60 * 60 * 1000;
    case "7d":
      return 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return 30 * 24 * 60 * 60 * 1000;
    case "all":
      return null;
  }
}
