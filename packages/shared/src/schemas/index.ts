// --- runtime exports (schemas, functions, classes) ---
export { healthResponseSchema, readyResponseSchema } from "./health";
export {
  channelManifestEntrySchema,
  channelManifestSchema,
  eventLocationSchema,
  eventTypeSchema,
  geoStructureSchema,
  ingestEnvelopeSchema,
  locationPrecisionSchema,
  macroZoneSchema,
  parseConfigSchema,
  parseCursorSchema,
  parsedEventSchema,
  rawMessageSchema,
  severitySchema,
} from "./ingest";
export {
  getActiveEventsQuerySchema,
  getEventsByRegionQuerySchema,
  getGeoSyncHistoryQuerySchema,
  getParseAttemptsQuerySchema,
  getRegionGeometryQuerySchema,
  syncAllCommandSchema,
  syncPlacesCommandSchema,
  syncRegionsCommandSchema,
} from "./cqrs";
export { domainEventSchema, domainEventTypeSchema } from "./events";
export {
  placeStatusActionSchema,
  placeStatusEventSchema,
} from "./events";
export {
  aliasDraftSchema,
  placeDraftSchema,
  regionDraftSchema,
  statusDictionaryEntrySchema,
  statusDictionarySchema,
} from "./geo";
export {
  parseReportClassificationSchema,
  parseReportEnrichSchema,
  parseReportEventSchema,
  parseReportGeoSchema,
  parseReportSchema,
} from "./reports";

// --- type-only exports ---
export type { HealthResponse, ReadyResponse } from "./health";
export type {
  ChannelManifest,
  ChannelManifestEntry,
  EventLocation,
  EventType,
  GeoStructure,
  IngestEnvelope,
  LocationPrecision,
  MacroZone,
  ParseConfig,
  ParseCursor,
  ParsedEvent,
  RawMessage,
  Severity,
} from "./ingest";
export type {
  GetActiveEventsQuery,
  GetEventsByRegionQuery,
  GetGeoSyncHistoryQuery,
  GetParseAttemptsQuery,
  GetRegionGeometryQuery,
  SyncAllCommand,
  SyncPlacesCommand,
  SyncRegionsCommand,
} from "./cqrs";
export type {
  DomainEvent,
  DomainEventType,
  PlaceStatusAction,
  PlaceStatusEvent,
} from "./events";
export type {
  AliasDraft,
  PlaceDraft,
  RegionDraft,
  StatusDictionary,
  StatusDictionaryEntry,
} from "./geo";
export type {
  ParseReport,
  ParseReportClassification,
  ParseReportEnrich,
  ParseReportEvent,
  ParseReportGeo,
} from "./reports";

