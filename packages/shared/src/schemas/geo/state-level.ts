import { z } from "zod";

/**
 * Уровень операционного состояния региона для карты.
 * SSOT для бэкенда и фронта (цвета уровней живут в DS-теме, не здесь).
 *
 * - grey   — нет данных / спокойно по умолчанию;
 * - green  — явный отбой (липкий до новой угрозы);
 * - yellow — внимание / БПЛА / превентивно у соседа red;
 * - orange — LLM-категория threat без точного subject (fallback);
 * - red    — опасность / ракетная опасность / ПВО в самом регионе.
 */
export const stateLevelSchema = z.enum(["grey", "green", "yellow", "orange", "red"]);

export type StateLevel = z.infer<typeof stateLevelSchema>;

/** Порядок эскалации тревоги: чем выше — тем острее. grey/green — не-тревожные. */
export const STATE_LEVEL_RANK: Record<StateLevel, number> = {
  grey: 0,
  green: 1,
  yellow: 2,
  orange: 3,
  red: 4,
};
