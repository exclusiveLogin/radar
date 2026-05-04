import { z } from "zod";

/**
 * Заготовка структурированного слоя (не только текст).
 * Формат уточним после примеров; пока — расширяемый контейнер.
 */
export const geoStructureSchema = z.object({
  region: z.string().optional(),
  city: z.string().optional(),
  /** Уровень тревоги / важности события — enum позже подстроим под домен. */
  level: z.string().optional(),
});

export type GeoStructure = z.infer<typeof geoStructureSchema>;
