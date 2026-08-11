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
import { ingestModeSchema } from "../ingest/ingest-domain.js";

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
  "RegionStateChanged",
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
  "PipelineStabilized",
  "ChannelBackfillCompleted",
  "StepRunRequested",
  "StepResetRequested",
  "StepStarted",
  "StepDrained",
  "StepFailed",
  "SystemInit",
  "SystemDrain",
]);

/** Контекст запуска шага на конверте события (lane / isolate / correlation). */
export const domainEventMetaSchema = z.object({
  stepId: z.string().optional(),
  runId: z.string().optional(),
  lane: ingestModeSchema.optional(),
  isolate: z.boolean().optional(),
  correlationId: z.string().optional(),
});
export type DomainEventMeta = z.infer<typeof domainEventMetaSchema>;

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
    "region",
    "system",
    "step",
  ]),
  aggregateId: z.string().nullable(),
  payload: z.record(z.unknown()),
  traceId: z.string().optional(),
  meta: domainEventMetaSchema.optional(),
});

export type DomainEvent = z.infer<typeof domainEventSchema>;
export type DomainEventType = z.infer<typeof domainEventTypeSchema>;
