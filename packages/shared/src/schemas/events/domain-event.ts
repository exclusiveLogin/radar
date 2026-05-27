/**
 * ---
 * layer: shared
 * kind: schema
 * domain: events
 * tooling: zod
 * purpose: Единый формат доменных событий для outbox/event-bus.
 * @see ../../../../../docs/domain/domain-events-and-outbox.md
 * @see ../../../../../docs/domain/aggregates.md
 * ---
 */
import { z } from "zod";

export const domainEventTypeSchema = z.enum([
  "RawMessageIngested",
  "RawMessageDuplicate",
  "IngestCursorAdvanced",
  "IngestSourceUnavailable",
  "IngestProviderCreated",
  "IngestProviderActivated",
  "IngestProviderPaused",
  "IngestProviderFailed",
  "IngestBindingAdded",
  "IngestBindingDisabled",
  "IngestBackfillJobStarted",
  "IngestBackfillChunkCompleted",
  "IngestBackfillJobFailed",
  "SessionSlotInvalidated",
  "SessionSlotDeployed",
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
    "ingest_provider",
    "ingest_binding",
    "session_slot",
    "geo_sync",
    "system",
  ]),
  aggregateId: z.string().nullable(),
  payload: z.record(z.unknown()),
  traceId: z.string().optional(),
});

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type DomainEventType = z.infer<typeof domainEventTypeSchema>;
