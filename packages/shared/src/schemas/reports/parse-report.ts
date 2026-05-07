import { z } from "zod";
import { eventTypeSchema } from "../ingest/event-type";
import { macroZoneSchema } from "../ingest/macro-zone";
import { severitySchema } from "../ingest/severity";

export const parseReportClassificationSchema = z.object({
  kind: z.enum(["noise", "meta", "event"]),
  reason: z.string().optional(),
});

export const parseReportEventSchema = z.object({
  eventType: eventTypeSchema,
  severity: severitySchema,
  repeat: z.boolean().default(false),
  count: z.number().int().positive().optional(),
  direction: z.string().optional(),
  macroZone: macroZoneSchema.optional(),
});

export const parseReportRegionSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  fiasId: z.string().optional(),
  federalDistrict: z.string().optional(),
  frontRegion: z.boolean().optional(),
  borderRegion: z.boolean().optional(),
});

export const parseReportPlaceSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["region", "district", "city", "locality", "settlement"]),
  fiasId: z.string().optional(),
  lat: z.number().finite().optional(),
  lon: z.number().finite().optional(),
  alias: z.string().optional(),
});

export const parseReportGeoSchema = z.object({
  region: parseReportRegionSchema.optional(),
  places: z.array(parseReportPlaceSchema).default([]),
  precision: z.enum([
    "unknown",
    "region",
    "district",
    "locality",
    "locality_with_coords",
  ]),
  completeness: z.number().min(0).max(1),
  source: z.enum(["local", "cache", "dadata", "nominatim", "llm"]),
});

export const parseReportEnrichSchema = z.object({
  invoked: z.boolean(),
  providersTried: z.array(z.enum(["dadata", "nominatim", "llm"])).default([]),
  hits: z.number().int().min(0).default(0),
  misses: z.number().int().min(0).default(0),
  cacheHit: z.boolean().default(false),
});

export const parseReportRawSchema = z.object({
  text: z.string(),
  hash: z.string().min(1),
  channelKey: z.string().optional(),
  postedAt: z.string().datetime().optional(),
  rawMessageId: z.string().uuid().optional(),
});

export const parseReportSchema = z.object({
  index: z.number().int().min(0).optional(),
  file: z.string().optional(),
  raw: parseReportRawSchema,
  classification: parseReportClassificationSchema,
  event: parseReportEventSchema.optional(),
  geo: parseReportGeoSchema,
  enrich: parseReportEnrichSchema.optional(),
  diagnostics: z
    .object({
      parserVersion: z.string().min(1),
      warnings: z.array(z.string()).default([]),
    })
    .optional(),
});

export type ParseReport = z.infer<typeof parseReportSchema>;
export type ParseReportClassification = z.infer<
  typeof parseReportClassificationSchema
>;
export type ParseReportEvent = z.infer<typeof parseReportEventSchema>;
export type ParseReportGeo = z.infer<typeof parseReportGeoSchema>;
export type ParseReportEnrich = z.infer<typeof parseReportEnrichSchema>;
