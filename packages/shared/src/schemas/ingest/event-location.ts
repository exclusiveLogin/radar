/**
 * ---
 * layer: shared
 * kind: schema
 * domain: ingest
 * tooling: zod
 * purpose: Нормализованная геопривязка события после резолва/обогащения.
 * ---
 */
import { z } from "zod";
import { locationPrecisionSchema } from "./location-precision";

export const eventLocationSchema = z.object({
  regionId: z.string().uuid(),
  placeId: z.string().uuid().optional(),
  regionCode: z.string().min(1),
  regionFias: z.string().optional(),
  placeName: z.string().optional(),
  placeFias: z.string().optional(),
  precision: locationPrecisionSchema,
  lat: z.number().finite().optional(),
  lon: z.number().finite().optional(),
  entityKind: z.enum(["region", "place", "point"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  authorChannelKey: z.string().min(1).optional(),
  action: z.enum(["raise", "clear"]).optional(),
  statusCode: z.string().min(1).optional(),
  occurredAt: z.string().datetime().optional(),
  source: z.enum(["db", "dadata", "nominatim", "llm", "cache"]),
});

export type EventLocation = z.infer<typeof eventLocationSchema>;
