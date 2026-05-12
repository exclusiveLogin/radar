import type { DomainEvent } from "../schemas/events/domain-event";
import type { EventLocation } from "../schemas/ingest/event-location";
import type { ParsedEvent } from "../schemas/ingest/parsed-event";
import type { RawMessage } from "../schemas/ingest/raw-message";

export type RegionRecord = {
  id: string;
  code: string;
  fiasId?: string;
  kladrId?: string;
  iso?: string;
  name: string;
  nameWithType?: string;
  shortName?: string;
  federalDistrict?: string;
  geometryArtifactKey?: string;
  sourceMeta?: Record<string, unknown>;
  lastSourceRevision?: string;
  frontRegion: boolean;
  borderRegion: boolean;
};

export type PlaceRecord = {
  id: string;
  regionId: string;
  parentPlaceId?: string;
  kind: "district" | "city" | "locality" | "settlement" | "urban_okrug" | "mo_go";
  name: string;
  nameWithType?: string;
  fiasId?: string;
  kladrId?: string;
  oktmo?: string;
  geometryArtifactKey?: string;
  centroidLat?: number;
  centroidLon?: number;
  bbox?: Record<string, unknown>;
  sourceMeta?: Record<string, unknown>;
  lastSourceRevision?: string;
  trustState?: "unverified" | "partially_verified" | "verified" | "rejected";
  isTrusted?: boolean;
  trustScore?: number;
  trustUpdatedAt?: string;
  evidenceProviders?: PlaceProvider[];
};

export type PlaceProvider = "catalog" | "dadata" | "nominatim" | "llm" | "operator" | "system";
export type PlaceCacheProvider = "dadata" | "nominatim" | "llm";

export type PlaceAliasRecord = {
  id: string;
  alias: string;
  aliasNormalized: string;
  targetKind: "region" | "place";
  regionId?: string;
  placeId?: string;
  source?: "auto" | "manual";
};

export type StatusDictionaryRecord = {
  code: string;
  title: string;
  includeOnMap: boolean;
  parserHints?: string[];
  isActive: boolean;
};

export type PlaceStatusActiveRecord = {
  placeId: string;
  statusCode: string;
  source: "parser" | "operator" | "system";
  startedAt: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
};

export type PlaceStatusHistoryRecord = {
  id: string;
  placeId: string;
  statusCode: string;
  action: "activate" | "deactivate";
  source: "parser" | "operator" | "system";
  eventAt: string;
  meta?: Record<string, unknown>;
};

export type PlaceEvidenceRecord = {
  id: string;
  placeId: string;
  provider: PlaceProvider;
  action: "candidate" | "confirm" | "reject" | "enrich";
  confidence?: number;
  payload?: Record<string, unknown>;
  traceId?: string;
  createdAt: string;
};

export type PlaceContribution = {
  placeId: string;
  provider: PlaceProvider;
  confidence?: number;
  traceId?: string;
  trustState: NonNullable<PlaceRecord["trustState"]>;
  isTrusted: boolean;
  trustScore: number;
  fields: Partial<
    Pick<
      PlaceRecord,
      | "name"
      | "nameWithType"
      | "kind"
      | "parentPlaceId"
      | "fiasId"
      | "kladrId"
      | "oktmo"
      | "geometryArtifactKey"
      | "centroidLat"
      | "centroidLon"
      | "bbox"
    >
  >;
  rawPayload?: Record<string, unknown>;
};

export type PlaceCacheHit = {
  provider: PlaceCacheProvider;
  raw: Record<string, unknown>;
  fetchedAt?: string;
  validatedAt?: string;
  confidence?: number;
};

export type PlaceCachePutMeta = {
  confidence?: number;
  validator?: "rule" | "human" | "provider";
  expiresAt?: string;
  validatedAt?: string;
};

export interface IRegionRepository {
  findByCode(code: string): Promise<RegionRecord | null>;
  listActive(): Promise<RegionRecord[]>;
  upsertMany(regions: RegionRecord[]): Promise<void>;
}

export interface IPlaceRepository {
  findById(id: string): Promise<PlaceRecord | null>;
  findByFias(fiasId: string): Promise<PlaceRecord | null>;
  findByNameInRegion(name: string, regionId: string): Promise<PlaceRecord | null>;
  listActive(): Promise<PlaceRecord[]>;
  upsertMany(places: PlaceRecord[]): Promise<void>;
  mergeContribution(input: PlaceContribution): Promise<{ updated: PlaceRecord; appliedFields: string[] }>;
}

export interface IPlaceAliasRepository {
  findByAlias(aliasNormalized: string): Promise<PlaceAliasRecord[]>;
  listActive(): Promise<PlaceAliasRecord[]>;
  upsertAlias(input: {
    targetKind: "region" | "place";
    regionId?: string;
    placeId?: string;
    alias: string;
    source: "auto" | "manual";
  }): Promise<void>;
  upsertMany(aliases: PlaceAliasRecord[]): Promise<void>;
}

export interface IRawMessageRepository {
  upsert(raw: RawMessage): Promise<{ inserted: boolean; id: string }>;
}

export interface IParsedEventRepository {
  upsert(parsed: ParsedEvent): Promise<{ id: string }>;
}

export interface IEventLocationRepository {
  replaceForParsedEvent(parsedEventId: string, locations: EventLocation[]): Promise<void>;
}

export interface IIngestCursorRepository {
  advance(channelKey: string, messageId: number, postedAt: string): Promise<void>;
}

export interface IPlaceCacheRepository {
  get(
    queryNorm: string,
    provider?: PlaceCacheProvider,
  ): Promise<PlaceCacheHit | null>;
  put(
    queryNorm: string,
    provider: PlaceCacheProvider,
    value: Record<string, unknown>,
    meta?: PlaceCachePutMeta,
  ): Promise<void>;
}

export interface IStatusDictionaryRepository {
  listActive(): Promise<StatusDictionaryRecord[]>;
  findByCode(code: string): Promise<StatusDictionaryRecord | null>;
}

export interface IPlaceStatusRepository {
  upsertActive(input: PlaceStatusActiveRecord): Promise<void>;
  deactivate(placeId: string, statusCode: string, atIso: string): Promise<void>;
  listActive(placeId: string): Promise<PlaceStatusActiveRecord[]>;
}

export interface IPlaceStatusHistoryRepository {
  append(record: PlaceStatusHistoryRecord): Promise<void>;
  listByPlace(placeId: string, limit: number): Promise<PlaceStatusHistoryRecord[]>;
}

export interface IPlaceEvidenceRepository {
  append(record: PlaceEvidenceRecord): Promise<void>;
  listByPlace(placeId: string, limit: number): Promise<PlaceEvidenceRecord[]>;
}

export interface ISyncAuditRepository {
  start(payload: Record<string, unknown>): Promise<{ id: string }>;
  finish(id: string, payload: Record<string, unknown>): Promise<void>;
}

export interface IDomainEventRepository {
  append(events: DomainEvent[]): Promise<void>;
}
