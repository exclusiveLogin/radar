import type { DomainEvent } from "../schemas/events/domain-event";
import type { EventLocation } from "../schemas/ingest/event-location";
import type { ParsedEvent } from "../schemas/ingest/parsed-event";
import type { RawMessage } from "../schemas/ingest/raw-message";

export type RegionRecord = {
  id: string;
  code: string;
  fiasId?: string;
  name: string;
  frontRegion: boolean;
  borderRegion: boolean;
};

export type PlaceRecord = {
  id: string;
  regionId: string;
  parentPlaceId?: string;
  kind: "district" | "city" | "locality" | "settlement" | "urban_okrug" | "mo_go";
  name: string;
  fiasId?: string;
};

export type PlaceAliasRecord = {
  id: string;
  alias: string;
  aliasNormalized: string;
  targetKind: "region" | "place";
  regionId?: string;
  placeId?: string;
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

export interface IRegionRepository {
  findByCode(code: string): Promise<RegionRecord | null>;
  upsertMany(regions: RegionRecord[]): Promise<void>;
}

export interface IPlaceRepository {
  findById(id: string): Promise<PlaceRecord | null>;
  findByFias(fiasId: string): Promise<PlaceRecord | null>;
  findByNameInRegion(name: string, regionId: string): Promise<PlaceRecord | null>;
  upsertMany(places: PlaceRecord[]): Promise<void>;
}

export interface IPlaceAliasRepository {
  findByAlias(aliasNormalized: string): Promise<PlaceAliasRecord[]>;
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
    provider?: "dadata" | "nominatim" | "llm",
  ): Promise<
    | {
        provider: "dadata" | "nominatim" | "llm";
        raw: Record<string, unknown>;
        fetchedAt?: string;
        validatedAt?: string;
        confidence?: number;
      }
    | null
  >;
  put(
    queryNorm: string,
    provider: "dadata" | "nominatim" | "llm",
    value: Record<string, unknown>,
    meta?: {
      confidence?: number;
      validator?: "rule" | "human" | "provider";
      expiresAt?: string;
      validatedAt?: string;
    },
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

export interface ISyncAuditRepository {
  start(payload: Record<string, unknown>): Promise<{ id: string }>;
  finish(id: string, payload: Record<string, unknown>): Promise<void>;
}

export interface IDomainEventRepository {
  append(events: DomainEvent[]): Promise<void>;
}
