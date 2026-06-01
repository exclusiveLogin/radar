/**
 * Контракты планировщика задач (ADR-003, Фаза G). Generic `job_definitions`
 * (что и по какому расписанию) + `job_runs` (конкретные запуски с прогрессом).
 * Паттерн повторяет `ingest_backfill_jobs`, но обобщён по типу задачи.
 */
import { z } from "zod";

/** Тип задачи. Маппится на исполнитель в job-type registry воркера. */
export const jobTypeSchema = z.enum([
  "reparse",
  "enrich-llm",
  "enrich-dadata",
  "enrich-nominatim",
]);
export type JobType = z.infer<typeof jobTypeSchema>;

export const jobRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "canceled",
]);
export type JobRunStatus = z.infer<typeof jobRunStatusSchema>;

/** Определение задачи (что запускать и по какому cron-расписанию). */
export const jobDefinitionSchema = z.object({
  id: z.string(),
  type: jobTypeSchema,
  params: z.record(z.unknown()).default({}),
  /** Cron-выражение (5 полей) или null для запуска только вручную. */
  cron: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobDefinition = z.infer<typeof jobDefinitionSchema>;

export const createJobDefinitionSchema = z.object({
  type: jobTypeSchema,
  params: z.record(z.unknown()).default({}),
  cron: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
});
export type CreateJobDefinition = z.infer<typeof createJobDefinitionSchema>;

export const updateJobDefinitionSchema = z.object({
  cron: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  params: z.record(z.unknown()).optional(),
});
export type UpdateJobDefinition = z.infer<typeof updateJobDefinitionSchema>;

/** Конкретный запуск задачи (instance) с прогрессом. */
export const jobRunSchema = z.object({
  id: z.string(),
  definitionId: z.string().nullable(),
  type: jobTypeSchema,
  params: z.record(z.unknown()).default({}),
  status: jobRunStatusSchema,
  stats: z.record(z.unknown()).default({}),
  error: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobRun = z.infer<typeof jobRunSchema>;
