import {
  healthResponseSchema,
  messageFeedResponseSchema,
  stateChangeEventsResponseSchema,
  readyResponseSchema,
  workerStatusResponseSchema,
  mapRegionsStateResponseSchema,
  mapPlacesStateResponseSchema,
  mapSnapshotSchema,
  sourceMessageResponseSchema,
  statusDictionarySchema,
  warningSchema,
  eventHeatmapResponseSchema,
  tracksListResponseSchema,
  tracksFlowResponseSchema,
  tracksGravityResponseSchema,
} from "@radar/shared";
import type {
  MapPlacesStateResponse,
  MapRegionsStateResponse,
  MapSnapshot,
  MessageFeedResponse,
  StateChangeEventsResponse,
  SourceMessage,
  StatusDictionary,
  Warning,
  EventHeatmapFilterType,
  EventHeatmapPeriod,
  EventHeatmapResponse,
  TracksListResponse,
  TracksFlowResponse,
  TracksGravityResponse,
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
  regionsState: (query?: { asOf?: string }): Promise<MapRegionsStateResponse> => {
    const params = new URLSearchParams();
    if (query?.asOf) params.set("asOf", query.asOf);
    const qs = params.toString();
    return getJson(
      `/api/map/regions-state${qs ? `?${qs}` : ""}`,
      mapRegionsStateResponseSchema,
    );
  },
  placesState: (query?: { asOf?: string; regionId?: string }): Promise<MapPlacesStateResponse> => {
    const params = new URLSearchParams();
    if (query?.asOf) params.set("asOf", query.asOf);
    if (query?.regionId) params.set("regionId", query.regionId);
    const qs = params.toString();
    return getJson(
      `/api/map/places-state${qs ? `?${qs}` : ""}`,
      mapPlacesStateResponseSchema,
    );
  },
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
    getJson("/api/map/status-dictionary", statusDictionarySchema),
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
  /** Контуры субъектов по ISO-кодам (lazy geo layer). */
  regionsGeoJson: (params: { regionCodes: string[] }): Promise<GeoJsonFeatureCollection> => {
    const qs = new URLSearchParams({
      regionCodes: params.regionCodes.join(","),
    });
    return getJson(`/api/map/regions-geojson?${qs}`, geoJsonFeatureCollectionSchema);
  },
  /** @deprecated bootstrap districts-active — lazy geoFeatureIds. */
  activeDistrictsGeoJson: (): Promise<GeoJsonFeatureCollection> =>
    getJson("/api/map/districts-active-geojson", geoJsonFeatureCollectionSchema),
  districtsGeoJson: (params?: {
    regionId?: string;
    geoFeatureIds?: string[];
  }): Promise<GeoJsonFeatureCollection> => {
    const qs = new URLSearchParams();
    if (params?.regionId) qs.set("regionId", params.regionId);
    if (params?.geoFeatureIds?.length) qs.set("geoFeatureIds", params.geoFeatureIds.join(","));
    const query = qs.toString();
    return getJson(
      `/api/map/districts-geojson${query ? `?${query}` : ""}`,
      geoJsonFeatureCollectionSchema,
    );
  },
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
    query?: { statusEventAt?: string },
  ): Promise<{ message: SourceMessage | null }> => {
    const params = new URLSearchParams();
    if (query?.statusEventAt) params.set("statusEventAt", query.statusEventAt);
    const qs = params.toString();
    return getJson(
      `/api/map/regions/by-code/${encodeURIComponent(regionCode)}/source-message${qs ? `?${qs}` : ""}`,
      sourceMessageResponse,
    );
  },
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

  tracksList: (params?: {
    asOf?: string;
    since?: string;
    threatProfile?: string;
    limit?: number;
    includeNodes?: boolean;
  }): Promise<TracksListResponse> => {
    const qs = new URLSearchParams();
    if (params?.asOf) qs.set("asOf", params.asOf);
    if (params?.since) qs.set("since", params.since);
    if (params?.threatProfile) qs.set("threatProfile", params.threatProfile);
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    if (params?.includeNodes) qs.set("includeNodes", "true");
    const query = qs.toString();
    return getJson(`/api/map/tracks${query ? `?${query}` : ""}`, tracksListResponseSchema);
  },

  tracksFlow: (params?: {
    asOf?: string;
    since?: string;
    threatProfile?: string;
    minCount?: number;
    limit?: number;
  }): Promise<TracksFlowResponse> => {
    const qs = new URLSearchParams();
    if (params?.asOf) qs.set("asOf", params.asOf);
    if (params?.since) qs.set("since", params.since);
    if (params?.threatProfile) qs.set("threatProfile", params.threatProfile);
    if (params?.minCount !== undefined) qs.set("minCount", String(params.minCount));
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return getJson(`/api/map/tracks/flow${query ? `?${query}` : ""}`, tracksFlowResponseSchema);
  },

  tracksGravity: (params?: {
    asOf?: string;
    since?: string;
    threatProfile?: string;
    geohashPrecision?: number;
  }): Promise<TracksGravityResponse> => {
    const qs = new URLSearchParams();
    if (params?.asOf) qs.set("asOf", params.asOf);
    if (params?.since) qs.set("since", params.since);
    if (params?.threatProfile) qs.set("threatProfile", params.threatProfile);
    if (params?.geohashPrecision !== undefined) {
      qs.set("geohashPrecision", String(params.geohashPrecision));
    }
    const query = qs.toString();
    return getJson(
      `/api/map/tracks/gravity${query ? `?${query}` : ""}`,
      tracksGravityResponseSchema,
    );
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
