/**
 * ---
 * layer: shared/schemas
 * domain: workbook (cross-context: tracking/parse/geo-enrich)
 * purpose: Read-side контракт для admin/web UI observability (Workbook Registry / Active
 *          Workloads / Run History) — единый по всем `pipelineKey`. Источник данных для UI —
 *          только signaling/materialization слои (WS + read REST), не runtime internals.
 * ---
 */
import { z } from "zod";

/** Три исполняемых контекста первой волны (см. tracking-parse-architecture-refactor plan). */
export const pipelineKeySchema = z.enum(["tracking", "parse", "geo-enrich"]);
export type PipelineKey = z.infer<typeof pipelineKeySchema>;

export const workbookPhaseDescriptorSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  label: z.string().optional(),
});
export type WorkbookPhaseDescriptorDto = z.infer<typeof workbookPhaseDescriptorSchema>;

/** Workbook Registry — что сконфигурировано (без исполнения pipeline). */
export const workbookRegistryEntrySchema = z.object({
  pipelineKey: pipelineKeySchema,
  phases: z.array(workbookPhaseDescriptorSchema),
});
export type WorkbookRegistryEntry = z.infer<typeof workbookRegistryEntrySchema>;

export const workloadStatusSchema = z.enum(["running", "paused", "waiting", "config-stale"]);
export type WorkloadStatus = z.infer<typeof workloadStatusSchema>;

/** Active Workloads — что сейчас выполняется. */
export const activeWorkloadSchema = z.object({
  pipelineKey: pipelineKeySchema,
  status: workloadStatusSchema,
  currentPhaseId: z.string().nullable(),
  cursor: z.unknown(),
  stats: z.record(z.string(), z.unknown()).optional(),
});
export type ActiveWorkload = z.infer<typeof activeWorkloadSchema>;

export const runOutcomeSchema = z.enum(["completed", "canceled", "paused", "failed"]);
export type RunOutcome = z.infer<typeof runOutcomeSchema>;

/** Run History — последние N запусков. */
export const runHistoryEntrySchema = z.object({
  runId: z.string(),
  pipelineKey: pipelineKeySchema,
  outcome: runOutcomeSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  counters: z.record(z.string(), z.number()).optional(),
});
export type RunHistoryEntry = z.infer<typeof runHistoryEntrySchema>;

export const workbookObservabilityResponseSchema = z.object({
  registry: z.array(workbookRegistryEntrySchema),
  activeWorkloads: z.array(activeWorkloadSchema),
  runHistory: z.array(runHistoryEntrySchema),
});
export type WorkbookObservabilityResponse = z.infer<typeof workbookObservabilityResponseSchema>;
