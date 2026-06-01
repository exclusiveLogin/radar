/**
 * Запуски фаз (phase_runs): прогресс, лог, кооперативное управление.
 */
import { z } from "zod";
import { phaseTriggerSchema } from "./phase.js";

export const phaseRunStatusSchema = z.enum([
  "pending",
  "running",
  "paused",
  "canceled",
  "completed",
  "failed",
]);
export type PhaseRunStatus = z.infer<typeof phaseRunStatusSchema>;

export const phaseRunControlSchema = z.enum(["cancel", "pause"]);
export type PhaseRunControl = z.infer<typeof phaseRunControlSchema>;

export const phaseRunLogEntrySchema = z.object({
  at: z.string(),
  level: z.enum(["info", "warn", "error"]).default("info"),
  message: z.string(),
});
export type PhaseRunLogEntry = z.infer<typeof phaseRunLogEntrySchema>;

/** Прогресс run — обновляется после каждого batch. */
export const phaseRunStatsSchema = z.object({
  claimed: z.number().int().nonnegative().default(0),
  processed: z.number().int().nonnegative().default(0),
  ok: z.number().int().nonnegative().default(0),
  failed: z.number().int().nonnegative().default(0),
  pendingRemaining: z.number().int().nonnegative().optional(),
  totalKnown: z.number().int().nonnegative().optional(),
});
export type PhaseRunStats = z.infer<typeof phaseRunStatsSchema>;

export const phaseRunSchema = z.object({
  id: z.string(),
  phaseId: z.string(),
  trigger: phaseTriggerSchema,
  status: phaseRunStatusSchema,
  stats: phaseRunStatsSchema.default({}),
  log: z.array(phaseRunLogEntrySchema).default([]),
  control: phaseRunControlSchema.nullable().default(null),
  error: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PhaseRun = z.infer<typeof phaseRunSchema>;

export const phaseReplayRequestSchema = z.object({
  phaseIds: z.array(z.string().min(1)).min(1),
  invalidateCoverage: z.boolean().default(true),
  resetMapState: z.boolean().default(false),
  runEagerNow: z.boolean().default(true),
});
export type PhaseReplayRequest = z.infer<typeof phaseReplayRequestSchema>;
