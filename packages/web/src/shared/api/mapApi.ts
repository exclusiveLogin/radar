import {
  mapSnapshotSchema,
  statusDictionarySchema,
  warningSchema,
} from "@radar/shared";
import type { MapSnapshot, StatusDictionary, Warning } from "@radar/shared";
import { z } from "zod";

const warningsSchema = z.array(warningSchema);

const geoRegionRefSchema = z.object({
  regionId: z.string(),
  regionCode: z.string(),
  name: z.string(),
  centroidLat: z.number().optional(),
  centroidLon: z.number().optional(),
  geometryArtifactKey: z.string().optional(),
});
const geoRegionsResponseSchema = z.object({ regions: z.array(geoRegionRefSchema) });

export type GeoRegionRef = z.infer<typeof geoRegionRefSchema>;

/** Тонкий REST-клиент карты: каждый ответ валидируется zod-контрактом. */
async function getJson<T>(url: string, schema: { parse: (data: unknown) => T }): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`);
  return schema.parse((await response.json()) as unknown);
}

export const mapApi = {
  snapshot: (since?: string): Promise<MapSnapshot> =>
    getJson(
      `/api/map/snapshot${since ? `?since=${encodeURIComponent(since)}` : ""}`,
      mapSnapshotSchema,
    ),
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
};

const geoJsonFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.unknown()),
});

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: unknown[];
};
