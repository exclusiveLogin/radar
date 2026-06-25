/**
 * ---
 * layer: shared
 * kind: schema
 * domain: map/tracking/flow
 * tooling: zod
 * purpose: API-контракты для flow-коридоров (L2 segment rollup) — GeoJSON LineString.
 * ---
 */
import { z } from "zod";
import { threatProfileSchema } from "./tracks";

/** GeoJSON feature одного flow-сегмента. */
const flowSegmentFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()])),
  }),
  properties: z.object({
    fromPlaceKey: z.string(),
    toPlaceKey: z.string(),
    count: z.number().int().positive(),
    weight: z.number().positive(),
    threatProfile: threatProfileSchema,
    lastSeenAt: z.string().datetime(),
  }),
});

export const tracksFlowResponseSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(flowSegmentFeatureSchema),
  meta: z.object({
    asOf: z.string().datetime(),
    count: z.number().int(),
    minCount: z.number().int(),
  }),
});

export type TracksFlowResponse = z.infer<typeof tracksFlowResponseSchema>;

/** Query-параметры для GET /map/tracks/flow */
export const tracksFlowQuerySchema = z.object({
  asOf: z.string().datetime().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  bbox: z.string().optional(),
  threatProfile: threatProfileSchema.optional(),
  minCount: z.coerce.number().int().min(1).default(2),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  splitByProfile: z.coerce.boolean().default(false),
});

export type TracksFlowQuery = z.infer<typeof tracksFlowQuerySchema>;
