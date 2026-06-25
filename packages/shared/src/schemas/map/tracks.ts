/**
 * ---
 * layer: shared
 * kind: schema
 * domain: map/tracking
 * tooling: zod
 * purpose: API-контракты для треков (L1) — запросы и ответы read-side.
 * ---
 */
import { z } from "zod";

export const nodeModeSchema = z.enum(["correct", "attach_only"]);
export const trackStatusSchema = z.enum(["active", "closed", "stale"]);
export const threatProfileSchema = z.enum(["uav", "rocket", "balloon", "unknown"]);

export type NodeMode = z.infer<typeof nodeModeSchema>;
export type TrackStatus = z.infer<typeof trackStatusSchema>;
export type ThreatProfile = z.infer<typeof threatProfileSchema>;

export const sourceRefSchema = z.object({
  eventLocationId: z.string().uuid().optional(),
  parsedEventId: z.string().uuid().optional(),
  rawMessageId: z.string().uuid().optional(),
  channelId: z.string().optional(),
  text: z.string().optional(),
});

export const trajectoryNodeSchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
  lat: z.number(),
  lon: z.number(),
  placeId: z.string().uuid().nullable(),
  mode: nodeModeSchema,
  sourceRefs: z.array(sourceRefSchema),
});

export const trajectoryTrackSchema = z.object({
  id: z.string().uuid(),
  status: trackStatusSchema,
  threatProfile: threatProfileSchema,
  firstAt: z.string().datetime(),
  lastAt: z.string().datetime(),
  lastLat: z.number(),
  lastLon: z.number(),
  velocityMs: z.number().nullable(),
  bearingDeg: z.number().nullable(),
  nodeCount: z.number().int().positive(),
  /** Накопленная дальность от origin (м). */
  totalDistanceM: z.number().nonnegative(),
  nodes: z.array(trajectoryNodeSchema).optional(),
});

export type TrajectoryNode = z.infer<typeof trajectoryNodeSchema>;
export type TrajectoryTrack = z.infer<typeof trajectoryTrackSchema>;

/** Query-параметры для GET /map/tracks */
export const tracksListQuerySchema = z.object({
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  asOf: z.string().datetime().optional(),
  /** "minLon,minLat,maxLon,maxLat" */
  bbox: z.string().optional(),
  status: trackStatusSchema.optional(),
  threatProfile: threatProfileSchema.optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
  /** Включать ноды в ответ (тяжело, только для detail). */
  includeNodes: z.coerce.boolean().default(false),
});

export type TracksListQuery = z.infer<typeof tracksListQuerySchema>;

export const tracksListResponseSchema = z.object({
  tracks: z.array(trajectoryTrackSchema),
  meta: z.object({
    asOf: z.string().datetime(),
    count: z.number().int(),
  }),
});

export type TracksListResponse = z.infer<typeof tracksListResponseSchema>;
