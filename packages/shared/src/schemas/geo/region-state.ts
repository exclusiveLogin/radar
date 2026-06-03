import { z } from "zod";
import { stateLevelSchema } from "./state-level";

/**
 * Контракты операционного состояния регионов: проекция, доменное событие смены,
 * лёгкий map-snapshot (без полигонов), смежность и фид предупреждений.
 */

/** Координата региона в тайл-гриде схемы (layout.json). */
export const layoutTileSchema = z.object({
  col: z.number().int().min(0),
  row: z.number().int().min(0),
});

/** Срез текущего состояния региона (строка проекции region_state_active). */
export const regionStateRecordSchema = z.object({
  regionId: z.string().uuid(),
  regionCode: z.string().min(1),
  stateLevel: stateLevelSchema,
  activity: z.number().int().min(0).default(0),
  reason: z.string().optional(),
  updatedAt: z.string().datetime(),
  /** Момент сообщения, зафиксировавшего текущий уровень (posted_at raw). */
  statusEventAt: z.string().datetime().optional(),
});

/** Полезная нагрузка доменного события `RegionStateChanged`. */
export const regionStateEventSchema = z.object({
  regionId: z.string().uuid(),
  regionCode: z.string().min(1),
  stateLevel: stateLevelSchema,
  previousLevel: stateLevelSchema,
  activity: z.number().int().min(0).default(0),
  reason: z.string().optional(),
  changedAt: z.string().datetime(),
  /** Момент сообщения-источника статуса (для подписи на карте). */
  statusEventAt: z.string().datetime().optional(),
  /** Для гео-карты при live-обновлении (если в БД нет centroid). */
  centroidLat: z.number().finite().optional(),
  centroidLon: z.number().finite().optional(),
  /** Тайл-координаты схемы (layout.json) — чтобы схема не ждала полного snapshot. */
  layout: layoutTileSchema.optional(),
});

/** Регион в лёгком снапшоте карты (без тяжёлой геометрии). */
export const mapRegionSnapshotSchema = z.object({
  regionId: z.string().uuid(),
  regionCode: z.string().min(1),
  name: z.string().min(1),
  stateLevel: stateLevelSchema,
  activity: z.number().int().min(0).default(0),
  layout: layoutTileSchema.optional(),
  centroidLat: z.number().finite().optional(),
  centroidLon: z.number().finite().optional(),
  statusEventAt: z.string().datetime().optional(),
});

/** Населённый пункт на гео-карте: активный статус ≠ grey и есть координаты. */
export const mapPlaceSnapshotSchema = z.object({
  placeId: z.string().uuid(),
  placeName: z.string().min(1),
  regionId: z.string().uuid(),
  regionCode: z.string().min(1),
  statusCode: z.string().min(1),
  stateLevel: stateLevelSchema,
  /** kind place: district/city_district/city/locality/settlement — для визуального ранжирования. */
  kind: z.string().optional(),
  /** FK geo_feature: если есть — фронт может запросить/показать полигон района. */
  geoFeatureId: z.string().uuid().optional(),
  lat: z.number().finite(),
  lon: z.number().finite(),
  updatedAt: z.string().datetime(),
  statusEventAt: z.string().datetime().optional(),
});

/** Событие смены статуса места (WS `place-state`). */
export const placeStateEventSchema = z.object({
  placeId: z.string().uuid(),
  placeName: z.string().min(1),
  regionId: z.string().uuid(),
  regionCode: z.string().min(1),
  statusCode: z.string().min(1),
  stateLevel: stateLevelSchema,
  action: z.enum(["activate", "deactivate"]),
  /** Тип места (district/city_district/city/locality) — для визуального ранжирования. */
  kind: z.string().optional(),
  /** FK geo_feature — если есть, фронт может связать место с полигоном района. */
  geoFeatureId: z.string().uuid().optional(),
  lat: z.number().finite().optional(),
  lon: z.number().finite().optional(),
  changedAt: z.string().datetime(),
});

/** Лёгкий снапшот карты: состояние + activity + layout, без полигонов. */
export const mapSnapshotSchema = z.object({
  generatedAt: z.string().datetime(),
  regions: z.array(mapRegionSnapshotSchema),
  places: z.array(mapPlaceSnapshotSchema).default([]),
});

/** Смежность регионов: code -> список соседних code (ненаправленная, симметричная). */
export const regionAdjacencySchema = z.object({
  version: z.literal(1).default(1),
  adjacency: z.record(z.string(), z.array(z.string())),
});

/** Дополнительное предупреждение для аккордеона (лёгкий список, не provenance). */
export const warningSchema = z.object({
  id: z.string(),
  regionId: z.string().uuid().optional(),
  regionCode: z.string().optional(),
  regionName: z.string().optional(),
  title: z.string().min(1),
  text: z.string().optional(),
  stateLevel: stateLevelSchema.optional(),
  eventAt: z.string().datetime(),
});

/** Исходное сообщение, последнее привязанное к региону/месту. */
export const sourceMessageSchema = z.object({
  rawText: z.string(),
  postedAt: z.string().datetime(),
  channelKey: z.string().optional(),
  /** Все ISO субъектов из того же parsed_event (мультирегион в одном raw). */
  regionCodes: z.array(z.string()).default([]),
});

export const sourceMessageResponseSchema = z.object({
  message: sourceMessageSchema.nullable(),
});

export type RegionStateRecord = z.infer<typeof regionStateRecordSchema>;
export type RegionStateEvent = z.infer<typeof regionStateEventSchema>;
export type LayoutTile = z.infer<typeof layoutTileSchema>;
export type MapRegionSnapshot = z.infer<typeof mapRegionSnapshotSchema>;
export type MapPlaceSnapshot = z.infer<typeof mapPlaceSnapshotSchema>;
export type PlaceStateEvent = z.infer<typeof placeStateEventSchema>;
export type MapSnapshot = z.infer<typeof mapSnapshotSchema>;
export type RegionAdjacency = z.infer<typeof regionAdjacencySchema>;
export type Warning = z.infer<typeof warningSchema>;
export type SourceMessage = z.infer<typeof sourceMessageSchema>;
