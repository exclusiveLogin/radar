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
  "mass_warning",
]);

export type EventType = z.infer<typeof eventTypeSchema>;

/**
 * Субъект угрозы — чем именно угрожают.
 * Используется для иконок на карте и уточнения контекста события.
 *
 * - drone    — БПЛА / дрон;
 * - rocket   — ракета / ракетная опасность;
 * - mws      — массированная волна / МВШ;
 * - aviation — авиация;
 * - other    — прочее или неизвестно.
 */
export const eventSubjectSchema = z.enum(["drone", "rocket", "mws", "aviation", "other"]);

export type EventSubject = z.infer<typeof eventSubjectSchema>;
