// --- runtime exports (schemas, functions, classes) ---
export {
  channelManifestEntrySchema,
  channelManifestSchema,
} from "./channel-manifest";
export { geoStructureSchema } from "./geo-structure";
export { ingestEnvelopeSchema } from "./ingest-envelope";
export { parseConfigSchema, parseCursorSchema } from "./parse-config";
export { eventTypeSchema } from "./event-type";
export { severitySchema } from "./severity";
export { locationPrecisionSchema } from "./location-precision";
export { macroZoneSchema } from "./macro-zone";
export { eventLocationSchema } from "./event-location";
export { parsedEventSchema } from "./parsed-event";
export { rawMessageSchema, rawMessageTelegramExtensionSchema } from "./raw-message";
export {
  ingestAdapterKindSchema,
  providerStatusSchema,
  ingestModeSchema,
  sourceKindSchema,
  bindingModeSchema,
  backfillStrategySchema,
  backfillJobStatusSchema,
} from "./ingest-domain";
export {
  credentialRefsSchema,
  adapterConfigSchema,
  ingestBindingRecordSchema,
  ingestProviderRecordSchema,
  createIngestProviderSchema,
  updateIngestProviderSchema,
  createIngestBindingSchema,
} from "./ingest-provider";
export { telegramAdapterConfigSchema } from "./telegram-adapter-config";
export { mtproxyTransportSchema } from "./mtproxy-transport";
export {
  manualIngestRequestSchema,
  manualIngestResponseSchema,
} from "./manual-ingest-request";
export {
  timelineOrderingKeySchema,
  timelineAnchorSchema,
  timelineQuerySchema,
  createBackfillJobSchema,
  backfillJobRecordSchema,
  timelineResponseSchema,
  fetchHistoryBatchSchema,
} from "./ingest-timeline";
export { ingestManifestEntrySchema, ingestManifestSchema } from "./ingest-manifest";
export {
  sessionKindSchema,
  sessionArtifactSchema,
  sessionDeployRequestSchema,
  sessionProbeResultSchema,
} from "./session-artifact";

// --- type-only exports ---
export type { ChannelManifest, ChannelManifestEntry } from "./channel-manifest";
export type { GeoStructure } from "./geo-structure";
export type { IngestEnvelope } from "./ingest-envelope";
export type { ParseConfig, ParseCursor } from "./parse-config";
export type { EventType } from "./event-type";
export type { Severity } from "./severity";
export type { LocationPrecision } from "./location-precision";
export type { MacroZone } from "./macro-zone";
export type { EventLocation } from "./event-location";
export type { ParsedEvent } from "./parsed-event";
export type { RawMessage, RawMessageTelegramExtension } from "./raw-message";
export type {
  IngestAdapterKind,
  ProviderStatus,
  IngestMode,
  SourceKind,
  BindingMode,
  BackfillStrategy,
  BackfillJobStatus,
} from "./ingest-domain";
export type {
  CredentialRefs,
  IngestBindingRecord,
  IngestProviderRecord,
  CreateIngestProvider,
  UpdateIngestProvider,
  CreateIngestBinding,
} from "./ingest-provider";
export type { TelegramAdapterConfig } from "./telegram-adapter-config";
export type { MtproxyTransport } from "./mtproxy-transport";
export type { ManualIngestRequest, ManualIngestResponse } from "./manual-ingest-request";
export type {
  TimelineOrderingKey,
  TimelineAnchor,
  TimelineQuery,
  CreateBackfillJob,
  BackfillJobRecord,
  TimelineResponse,
} from "./ingest-timeline";
export type { IngestManifestEntry, IngestManifest } from "./ingest-manifest";
export type {
  SessionKind,
  SessionArtifact,
  SessionDeployRequest,
  SessionProbeResult,
  SessionMaterial,
  SessionWriteInput,
} from "./session-artifact";
