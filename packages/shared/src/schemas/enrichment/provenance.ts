/**
 * Контракт накопителя (ADR-003): каждое поле parsed event несёт провенанс
 * `{ value, source, trust, precision }`. Источник и precision задают правило
 * слияния в `mergeContribution` (SSOT merge), trust разрешает ничьи.
 */
import { z } from "zod";

/** Источник вклада энричера. Наследует policy доверия ADR-002. */
export const enrichmentSourceSchema = z.enum([
  "catalog",
  "rule",
  "llm",
  "dadata",
  "nominatim",
  "operator",
  "system",
]);
export type EnrichmentSource = z.infer<typeof enrichmentSourceSchema>;

/** Базовый trust источника (SSOT). Совпадает с policy ADR-002. */
export const SOURCE_TRUST: Record<EnrichmentSource, number> = {
  catalog: 1.0,
  operator: 1.0,
  dadata: 0.95,
  nominatim: 0.8,
  rule: 0.7,
  system: 0.7,
  llm: 0.55,
};

/**
 * Ранг точности поля (precision/complexity). Чем выше — тем «сильнее» вклад
 * при слиянии. Атрибутные поля используют `attribute` как нейтральный уровень.
 */
export const mergePrecisionSchema = z.enum([
  "unknown",
  "attribute",
  "region",
  "district",
  "locality",
  "locality_with_coords",
]);
export type MergePrecision = z.infer<typeof mergePrecisionSchema>;

/** Числовой ранг precision для сравнения вкладов (SSOT). */
export const PRECISION_RANK: Record<MergePrecision, number> = {
  unknown: 0,
  attribute: 1,
  region: 2,
  district: 3,
  locality: 4,
  locality_with_coords: 5,
};

/** Метаданные провенанса без значения (общая часть любого поля). */
export const provenanceMetaSchema = z.object({
  source: enrichmentSourceSchema,
  trust: z.number().min(0).max(1),
  precision: mergePrecisionSchema,
});
export type ProvenanceMeta = z.infer<typeof provenanceMetaSchema>;

/** Поле накопителя с провенансом. Фабрика под конкретный тип значения. */
export function fieldProvenance<T extends z.ZodTypeAny>(value: T) {
  return provenanceMetaSchema.extend({ value });
}

export type FieldProvenance<T> = ProvenanceMeta & { value: T };
