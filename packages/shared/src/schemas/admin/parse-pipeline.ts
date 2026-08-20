/**
 * ---
 * layer: shared
 * kind: schema
 * domain: admin
 * tooling: zod
 * purpose: Статус операции parse rebuild из админки.
 * ---
 */
import { z } from "zod";

/** Единственная штатная операция: wipe parse-слоя + enqueue catch-up. */
export const parsePipelineJobKindSchema = z.enum(["rebuild"]);
export type ParsePipelineJobKind = z.infer<typeof parsePipelineJobKindSchema>;

export const parsePipelineJobStatusSchema = z.enum([
  "idle",
  "running",
  "completed",
  "failed",
]);
export type ParsePipelineJobStatus = z.infer<typeof parsePipelineJobStatusSchema>;

/** Этап внутри rebuild — для понятного UI вместо «висит». */
export const parsePipelinePhaseSchema = z.enum([
  "wiping",
  "enqueueing",
  "processing",
]);
export type ParsePipelinePhase = z.infer<typeof parsePipelinePhaseSchema>;

/** Ответ GET /admin/parse/status — прогресс rebuild (CLI wipe, затем очередь). */
export const parsePipelineStatusResponseSchema = z.object({
  status: parsePipelineJobStatusSchema,
  kind: parsePipelineJobKindSchema.nullable(),
  phase: parsePipelinePhaseSchema.nullable(),
  detail: z.string().nullable(),
  logTail: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
  totalMessages: z.number().int().nonnegative(),
  processedMessages: z.number().int().nonnegative(),
  ok: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  percentApprox: z.number().min(0).max(100),
});
export type ParsePipelineStatusResponse = z.infer<typeof parsePipelineStatusResponseSchema>;

export const parsePipelineStartResponseSchema = z.object({
  ok: z.literal(true),
  kind: parsePipelineJobKindSchema,
});
export type ParsePipelineStartResponse = z.infer<typeof parsePipelineStartResponseSchema>;
