import { z } from "zod";
import { stateLevelSchema } from "./state-level";

/**
 * Контракты операционного состояния регионов: проекция, доменное событие смены,
 * лёгкий map-snapshot (без полигонов), смежность и фид предупреждений.
 */

/** Срез текущего состояния региона (строка проекции region_state_active). */
export const regionStateRecordSchema = z.object({
  regionId: z.string().uuid(),
  regionCode: z.string().min(1),
  stateLevel: stateLevelSchema,
  activity: z.number().int().min(0).default(0),
  reason: z.string().optional(),
  updatedAt: z.string().datetime(),
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
});

/** Координата региона в тайл-гриде схемы (layout.json). */
export const layoutTileSchema = z.object({
  col: z.number().int().min(0),
  row: z.number().int().min(0),
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
});

/** Лёгкий снапшот карты: состояние + activity + layout, без полигонов. */
export const mapSnapshotSchema = z.object({
  generatedAt: z.string().datetime(),
  regions: z.array(mapRegionSnapshotSchema),
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
  title: z.string().min(1),
  text: z.string().optional(),
  stateLevel: stateLevelSchema.optional(),
  eventAt: z.string().datetime(),
});

export type RegionStateRecord = z.infer<typeof regionStateRecordSchema>;
export type RegionStateEvent = z.infer<typeof regionStateEventSchema>;
export type LayoutTile = z.infer<typeof layoutTileSchema>;
export type MapRegionSnapshot = z.infer<typeof mapRegionSnapshotSchema>;
export type MapSnapshot = z.infer<typeof mapSnapshotSchema>;
export type RegionAdjacency = z.infer<typeof regionAdjacencySchema>;
export type Warning = z.infer<typeof warningSchema>;
