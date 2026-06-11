/**
 * Контракт read-side теплокарты событий (GeoJSON + meta).
 */
import { z } from "zod";
import { stateLevelSchema } from "../geo/state-level";

/** Пресет окна выборки для heatmap. */
export const eventHeatmapPeriodSchema = z.enum(["24h", "7d", "30d", "all"]);

export type EventHeatmapPeriod = z.infer<typeof eventHeatmapPeriodSchema>;

export const eventHeatmapMetaSchema = z.object({
  period: eventHeatmapPeriodSchema,
  since: z.string().datetime().nullable(),
  until: z.string().datetime(),
  count: z.number().int().nonnegative(),
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
