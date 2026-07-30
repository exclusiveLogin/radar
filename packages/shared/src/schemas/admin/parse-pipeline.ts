/**
 * ---
 * layer: shared
 * kind: schema
 * domain: admin
 * tooling: zod
 * purpose: Статус операций parse pipeline (reset / catch-up) из админки.
 * ---
 */
import { z } from "zod";

export const parsePipelineJobKindSchema = z.enum(["reset", "catchup"]);
export type ParsePipelineJobKind = z.infer<typeof parsePipelineJobKindSchema>;

export const parsePipelineJobStatusSchema = z.enum([
  "idle",
  "running",
  "completed",
  "failed",
]);
export type ParsePipelineJobStatus = z.infer<typeof parsePipelineJobStatusSchema>;

/** Ответ GET /admin/parse/status — прогресс фоновой CLI-операции. */
export const parsePipelineStatusResponseSchema = z.object({
  status: parsePipelineJobStatusSchema,
  kind: parsePipelineJobKindSchema.nullable(),
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
