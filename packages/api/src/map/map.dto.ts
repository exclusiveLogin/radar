import { z } from "zod";

/** Лёгкая запись региона для гео-виджета: метаданные геометрии без тяжёлых полигонов inline. */
export const geoRegionRefSchema = z.object({
  regionId: z.string().uuid(),
  regionCode: z.string(),
  name: z.string(),
  centroidLat: z.number().finite().optional(),
  centroidLon: z.number().finite().optional(),
  bbox: z.unknown().optional(),
  geometryArtifactKey: z.string().optional(),
});

export const geoRegionsResponseSchema = z.object({
  regions: z.array(geoRegionRefSchema),
});

/** Геометрия одного региона (ленивая подгрузка гео-виджетом). */
export const regionGeometrySchema = geoRegionRefSchema;

/** Лёгкая запись места. */
export const placeRefSchema = z.object({
  id: z.string().uuid(),
  regionId: z.string().uuid(),
  name: z.string(),
  kind: z.string(),
  centroidLat: z.number().finite().optional(),
  centroidLon: z.number().finite().optional(),
});

export const placesResponseSchema = z.object({
  places: z.array(placeRefSchema),
});

export type GeoRegionRef = z.infer<typeof geoRegionRefSchema>;
export type PlaceRef = z.infer<typeof placeRefSchema>;
