/**
 * ---
 * layer: shared
 * kind: schema
 * domain: map/tracks
 * purpose: Контракт API gravity heatmap — историческая плотность узлов треков.
 * ---
 */
import { z } from "zod";

export const tracksGravityQuerySchema = z.object({
  asOf: z.string().datetime().optional(),
  since: z.string().datetime().optional(),
  threatProfile: z.enum(["uav", "rocket", "balloon", "unknown"]).optional(),
  geohashPrecision: z.coerce.number().int().min(3).max(10).default(5),
});

export type TracksGravityQuery = z.infer<typeof tracksGravityQuerySchema>;

export const tracksGravityFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z.object({
    zoneKey: z.string(),
    mass: z.number().nonnegative(),
  }),
});

export const tracksGravityResponseSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(tracksGravityFeatureSchema),
  asOf: z.string().datetime(),
});

export type TracksGravityResponse = z.infer<typeof tracksGravityResponseSchema>;
