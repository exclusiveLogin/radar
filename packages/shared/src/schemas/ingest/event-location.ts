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
  source: z.enum(["db", "dadata", "nominatim", "llm", "cache"]),
});

export type EventLocation = z.infer<typeof eventLocationSchema>;
