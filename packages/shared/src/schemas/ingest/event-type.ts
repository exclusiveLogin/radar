import { z } from "zod";

export const eventTypeSchema = z.enum([
  "fixation",
  "attention",
  "danger",
  "pvo_work",
  "impact",
  "cleared",
  "safety_measures",
  "rocket_threat",
  "airspace_restriction",
  /** Предупреждение (приготовиться, тревога); массовость — trait extras.mass. */
  "warning",
  /** Оперативное сбитие БПЛА/МВШ/ракеты — с геолокацией, красный уровень. */
  "intercept",
  /** Сводная статистика ПВО за период — без влияния на карту. */
  "pvo_report",
]);

export type EventType = z.infer<typeof eventTypeSchema>;

/**
 * Субъект угрозы — чем именно угрожают.
 * Используется для иконок на карте и уточнения контекста события.
 *
 * - drone    — БПЛА / дрон;
 * - rocket   — ракета / ракетная опасность;
 * - mws      — МВШ (малоразмерный воздушный шар);
 * - aviation — авиация;
 * - other    — прочее или неизвестно.
 */
export const eventSubjectSchema = z.enum(["drone", "rocket", "mws", "aviation", "other"]);

export type EventSubject = z.infer<typeof eventSubjectSchema>;

/**
 * Структурированные данные сводки ПВО.
 * Хранится в `parsed_events.extras->>'pvo'` как JSONB.
 */
export const pvoStatsSchema = z.object({
  /** Текстовое описание периода: "С 14:00 до 20:00", "прошедшую ночь" и т.п. */
  period: z.string().optional(),
  /** Суммарные счётчики по типам поражённых целей. */
  totals: z.object({
    drones:   z.number().optional(),
    rockets:  z.number().optional(),
    balloons: z.number().optional(),
  }),
  /** Все упомянутые регионы — ISO-код + полное имя. */
  regions: z.array(z.object({
    code: z.string(),
    name: z.string(),
  })),
  /** Счётчики по регионам (только если шаблон с разбивкой "над X областью уничтожено N"). */
  byRegion: z.array(z.object({
    code:     z.string(),
    name:     z.string(),
    drones:   z.number().optional(),
    rockets:  z.number().optional(),
    balloons: z.number().optional(),
  })).optional(),
});

export type PvoStats = z.infer<typeof pvoStatsSchema>;
