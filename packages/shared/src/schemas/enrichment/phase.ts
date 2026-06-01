/**
 * Абстракция Phase (ADR-003): фаза = упорядоченный `enrichers[]` + терминальный
 * MergeStep. Один и тот же контракт исполняется по двум триггерам — eager
 * (событие `MessageParsed`) и lazy (job/queue). Фазы объявляются манифестом в
 * коде и попадают в БД `phase_definitions` (паттерн ingest-манифеста).
 */
import { z } from "zod";

/** Идентификатор энричера (field-agnostic поставщик полей с провенансом). */
export const enricherIdSchema = z.enum([
  "catalog",
  "rule",
  "llm",
  "dadata",
  "nominatim",
]);
export type EnricherId = z.infer<typeof enricherIdSchema>;

/** Триггер фазы: eager — синхронно по событию, lazy — по job/queue. */
export const phaseKindSchema = z.enum(["eager", "lazy"]);
export type PhaseKind = z.infer<typeof phaseKindSchema>;

/**
 * Stage очереди обогащения — провайдерный проход lazy-фазы.
 * Совпадает с подмножеством `enricherId` тяжёлых провайдеров.
 */
export const enrichStageSchema = z.enum(["llm", "dadata", "nominatim"]);
export type EnrichStage = z.infer<typeof enrichStageSchema>;

/** Запись манифеста фазы — авторинг в коде, операционирование в БД. */
export const phaseManifestEntrySchema = z.object({
  id: z.string().min(1),
  kind: phaseKindSchema,
  /** Stage для lazy-фазы (ключ очереди). Для eager обычно отсутствует. */
  stage: enrichStageSchema.optional(),
  enrichers: z.array(enricherIdSchema).min(1),
  enabled: z.boolean().default(true),
  /** Порядок исполнения среди фаз одного типа. */
  order: z.number().int().nonnegative().default(0),
});
export type PhaseManifestEntry = z.infer<typeof phaseManifestEntrySchema>;

export const phaseManifestSchema = z.object({
  version: z.literal(1).default(1),
  phases: z.array(phaseManifestEntrySchema).default([]),
});
export type PhaseManifest = z.infer<typeof phaseManifestSchema>;

/** Операционная запись фазы из БД (`phase_definitions`). */
export const phaseDefinitionSchema = phaseManifestEntrySchema.extend({
  updatedAt: z.string().optional(),
});
export type PhaseDefinition = z.infer<typeof phaseDefinitionSchema>;
