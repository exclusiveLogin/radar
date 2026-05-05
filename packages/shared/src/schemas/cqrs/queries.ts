/**
 * ---
 * layer: shared
 * kind: schema
 * domain: cqrs
 * tooling: zod
 * purpose: Контракты read-side запросов (events/regions/parse-attempts/geo-sync).
 * ---
 */
import { z } from "zod";

export const getActiveEventsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

export const getEventsByRegionQuerySchema = z.object({
  regionId: z.string().uuid().optional(),
  regionCode: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

export const getRegionGeometryQuerySchema = z.object({
  regionId: z.string().uuid().optional(),
  regionCode: z.string().min(1).optional(),
});

export const getParseAttemptsQuerySchema = z.object({
  limit: z.number().int().min(1).max(1000).default(100),
  status: z.enum(["ok", "failed", "skipped"]).optional(),
});

export const getGeoSyncHistoryQuerySchema = z.object({
  limit: z.number().int().min(1).max(1000).default(50),
});

export type GetActiveEventsQuery = z.infer<typeof getActiveEventsQuerySchema>;
export type GetEventsByRegionQuery = z.infer<typeof getEventsByRegionQuerySchema>;
export type GetRegionGeometryQuery = z.infer<typeof getRegionGeometryQuerySchema>;
export type GetParseAttemptsQuery = z.infer<typeof getParseAttemptsQuerySchema>;
export type GetGeoSyncHistoryQuery = z.infer<typeof getGeoSyncHistoryQuerySchema>;
