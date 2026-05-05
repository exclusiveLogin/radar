/**
 * ---
 * layer: shared
 * kind: schema
 * domain: events
 * tooling: zod
 * purpose: Единый формат доменных событий для outbox/event-bus.
 * ---
 */
import { z } from "zod";

export const domainEventTypeSchema = z.enum([
  "RawMessageIngested",
  "RawMessageDuplicate",
  "IngestCursorAdvanced",
  "IngestSourceUnavailable",
  "MessageClassified",
  "MessageParsed",
  "MessageParseFailed",
  "ParseRetryScheduled",
  "EnricherInvoked",
  "EnricherCacheHit",
  "EnricherFailed",
  "GeoSyncStarted",
  "GeoSyncCompleted",
  "GeoSyncFailed",
  "MetricSampleEmitted",
  "HealthSnapshotEmitted",
  "RateLimitTripped",
]);

export const domainEventSchema = z.object({
  id: z.string().uuid(),
  type: domainEventTypeSchema,
  version: z.number().int().positive().default(1),
  occurredAt: z.string().datetime(),
  aggregateType: z.enum([
    "raw_message",
    "parsed_event",
    "channel",
    "geo_sync",
    "system",
  ]),
  aggregateId: z.string().nullable(),
  payload: z.record(z.unknown()),
  traceId: z.string().optional(),
});

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type DomainEventType = z.infer<typeof domainEventTypeSchema>;
