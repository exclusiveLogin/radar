import {
  healthResponseSchema,
  messageFeedResponseSchema,
  stateChangeEventsResponseSchema,
  readyResponseSchema,
  workerStatusResponseSchema,
  mapSnapshotSchema,
  sourceMessageResponseSchema,
  statusDictionarySchema,
  warningSchema,
  eventHeatmapResponseSchema,
} from "@radar/shared";
import type {
  MapSnapshot,
  MessageFeedResponse,
  StateChangeEventsResponse,
  SourceMessage,
  StatusDictionary,
  Warning,
  EventHeatmapFilterType,
  EventHeatmapPeriod,
  EventHeatmapResponse,
} from "@radar/shared";
import { z } from "zod";

export type TopActivityRow = { regionCode: string; name: string; eventCount: number };

const warningsSchema = z.array(warningSchema);
const sourceMessageResponse = sourceMessageResponseSchema;

const geoRegionRefSchema = z.object({
  regionId: z.string(),
  regionCode: z.string(),
  name: z.string(),
  centroidLat: z.number().optional(),
  centroidLon: z.number().optional(),
  geometryArtifactKey: z.string().optional(),
});
const geoRegionsResponseSchema = z.object({ regions: z.array(geoRegionRefSchema) });

/** Схема ingest-провайдера (read-only для дашборда). */
export const ingestProviderSchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  adapterKind: z.string(),
  status: z.enum(["draft", "active", "paused", "error"]),
  lastError: z.string().nullable(),
  lastHeartbeatAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type IngestProvider = z.infer<typeof ingestProviderSchema>;

const ingestProvidersSchema = z.array(ingestProviderSchema);

export type GeoRegionRef = z.infer<typeof geoRegionRefSchema>;

/** Тонкий REST-клиент карты: каждый ответ валидируется zod-контрактом. */
async function getJson<T>(url: string, schema: { parse: (data: unknown) => T }): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`);
  return schema.parse((await response.json()) as unknown);
}

export type MapSnapshotQuery = {
  /** Live incremental cursor (deprecated, fold-only). */
  since?: string;
  /** Historical fold на маркер времени (read-line). */
  asOf?: string;
};

export const mapApi = {
  snapshot: (query?: MapSnapshotQuery): Promise<MapSnapshot> => {
    const params = new URLSearchParams();
    if (query?.since) params.set("since", query.since);
    if (query?.asOf) params.set("asOf", query.asOf);
    const qs = params.toString();
    return getJson(
      `/api/map/snapshot${qs ? `?${qs}` : ""}`,
      mapSnapshotSchema,
    );
  },
  statusDictionary: (): Promise<StatusDictionary> =>
    getJson("/api/status-dictionary", statusDictionarySchema),
  warnings: (params?: { regionId?: string; since?: string }): Promise<Warning[]> => {
    const query = new URLSearchParams();
    if (params?.since) query.set("since", params.since);
    const base = params?.regionId
      ? `/api/regions/${encodeURIComponent(params.regionId)}/warnings`
      : "/api/warnings";
    const qs = query.toString();
    return getJson(`${base}${qs ? `?${qs}` : ""}`, warningsSchema);
  },
  geoRegions: (): Promise<GeoRegionRef[]> =>
    getJson("/api/geo/regions", geoRegionsResponseSchema).then((r) => r.regions),
  /** Полигоны субъектов РФ (OSM artifacts) с regionCode/stateLevel. */
  regionsGeoJson: (): Promise<GeoJsonFeatureCollection> =>
    getJson("/api/map/regions-geojson", geoJsonFeatureCollectionSchema),
  /**
   * Полигоны только активных районов (place_status raise).
   * Лёгкий ответ — вызывается при каждом обновлении снапшота places.
   */
  activeDistrictsGeoJson: (): Promise<GeoJsonFeatureCollection> =>
    getJson("/api/map/districts-active-geojson", geoJsonFeatureCollectionSchema),
  /** Полигоны всех районов из geo_feature (district/city_district), опционально по regionId. */
  districtsGeoJson: (params?: { regionId?: string }): Promise<GeoJsonFeatureCollection> =>
    getJson(
      `/api/map/districts-geojson${params?.regionId ? `?regionId=${encodeURIComponent(params.regionId)}` : ""}`,
      geoJsonFeatureCollectionSchema,
    ),
  /** Список ingest-провайдеров (статус каналов). */
  providers: (): Promise<IngestProvider[]> =>
    getJson("/api/admin/ingest/providers", ingestProvidersSchema),
  health: () => getJson("/api/health", healthResponseSchema),
  ready: () => getJson("/api/ready", readyResponseSchema),
  workerStatus: () => getJson("/api/worker/status", workerStatusResponseSchema),
  /** Лента сырых сообщений всех каналов. */
  recentMessages: (limit = 80): Promise<MessageFeedResponse> =>
    getJson(`/api/map/messages/recent?limit=${limit}`, messageFeedResponseSchema),
  recentStateChangeEvents: (limit = 80): Promise<StateChangeEventsResponse> =>
    getJson(`/api/map/events/recent?limit=${limit}`, stateChangeEventsResponseSchema),
  regionSourceMessage: (
    regionCode: string,
  ): Promise<{ message: SourceMessage | null }> =>
    getJson(
      `/api/map/regions/by-code/${encodeURIComponent(regionCode)}/source-message`,
      sourceMessageResponse,
    ),
  placeSourceMessage: (
    placeId: string,
  ): Promise<{ message: SourceMessage | null }> =>
    getJson(
      `/api/map/places/${encodeURIComponent(placeId)}/source-message`,
      sourceMessageResponse,
    ),
  /** Сводки ПВО — информационная лента без влияния на карту. */
  pvoReports: (limit = 50, since?: string): Promise<PvoReportsResponse> => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (since) qs.set("since", since);
    return getJson(`/api/map/pvo-reports?${qs}`, pvoReportsResponseSchema);
  },
  /** Смежность регионов — для read-side вычисления уровня соседей (загружается однократно). */
  regionAdjacency: (): Promise<Record<string, string[]>> =>
    getJson("/api/map/region-adjacency", z.record(z.string(), z.array(z.string()))),
  /** Топ регионов по danger-событиям за 7 дней (для TopActivityWidget). */
  topActivity: (limit = 10): Promise<{ items: TopActivityRow[] }> =>
    getJson(
      `/api/map/regions/top-activity?limit=${limit}`,
      z.object({ items: z.array(z.object({ regionCode: z.string(), name: z.string(), eventCount: z.number() })) }),
    ),
  /** История событий конкретного региона для RegionDetailWidget. */
  regionEvents: (code: string, limit = 50): Promise<StateChangeEventsResponse> =>
    getJson(
      `/api/map/regions/by-code/${encodeURIComponent(code)}/events?limit=${limit}`,
      stateChangeEventsResponseSchema,
    ),
  /** Теплокарта raise-событий (GeoJSON Point + meta). */
  eventsHeatmap: (params: {
    period: EventHeatmapPeriod;
    until?: string;
    limit?: number;
    eventTypes?: EventHeatmapFilterType[];
  }): Promise<EventHeatmapResponse> => {
    const qs = new URLSearchParams({ period: params.period });
    if (params.until) qs.set("until", params.until);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.eventTypes?.length) qs.set("eventTypes", params.eventTypes.join(","));
    return getJson(`/api/map/events/heatmap?${qs}`, eventHeatmapResponseSchema);
  },
};

const geoJsonFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.unknown()),
});

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: unknown[];
};

const pvoRegionSchema = z.object({
  code: z.string(),
  name: z.string(),
});

const pvoByRegionSchema = pvoRegionSchema.extend({
  drones:   z.number().optional(),
  rockets:  z.number().optional(),
  balloons: z.number().optional(),
});

const pvoStatsSchema = z.object({
  period:   z.string().optional(),
  totals:   z.object({
    drones:   z.number().optional(),
    rockets:  z.number().optional(),
    balloons: z.number().optional(),
  }),
  regions:  z.array(pvoRegionSchema),
  byRegion: z.array(pvoByRegionSchema).optional(),
});

const pvoReportItemSchema = z.object({
  id:           z.string(),
  postedAt:     z.string(),
  channelKey:   z.string(),
  channelTitle: z.string(),
  rawText:      z.string(),
  stats:        pvoStatsSchema.nullable(),
});

const pvoReportsResponseSchema = z.object({
  items: z.array(pvoReportItemSchema),
});

export type PvoReportItem = z.infer<typeof pvoReportItemSchema>;
export type PvoReportsResponse = z.infer<typeof pvoReportsResponseSchema>;
