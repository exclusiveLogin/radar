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

export interface IRegionRepository {
  findByCode(code: string): Promise<RegionRecord | null>;
  upsertMany(regions: RegionRecord[]): Promise<void>;
}

export interface IPlaceRepository {
  findById(id: string): Promise<PlaceRecord | null>;
  upsertMany(places: PlaceRecord[]): Promise<void>;
}

export interface IPlaceAliasRepository {
  findByAlias(aliasNormalized: string): Promise<PlaceAliasRecord[]>;
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
  get(queryNorm: string): Promise<Record<string, unknown> | null>;
  put(queryNorm: string, value: Record<string, unknown>): Promise<void>;
}

export interface ISyncAuditRepository {
  start(payload: Record<string, unknown>): Promise<{ id: string }>;
  finish(id: string, payload: Record<string, unknown>): Promise<void>;
}

export interface IDomainEventRepository {
  append(events: DomainEvent[]): Promise<void>;
}
