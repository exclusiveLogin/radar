/**
 * ---
 * layer: shared
 * kind: schema
 * domain: admin/pipeline
 * tooling: zod
 * purpose: Контракты topology API и ответов run/reset step.
 * ---
 */
import { z } from "zod";

export const pipelineStepRunRequestSchema = z.object({
  isolate: z.boolean().optional(),
  ids: z.array(z.string().min(1)).optional(),
  lane: z.enum(["manual", "backfill"]).optional(),
});
export type PipelineStepRunRequest = z.infer<typeof pipelineStepRunRequestSchema>;

export const pipelineStepRunResponseSchema = z.object({
  ok: z.literal(true),
  stepId: z.string().min(1),
  eventId: z.string().uuid(),
  correlationId: z.string().min(1),
});
export type PipelineStepRunResponse = z.infer<typeof pipelineStepRunResponseSchema>;

export const pipelineStepResetRequestSchema = z.object({
  cascade: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});
export type PipelineStepResetRequest = z.infer<typeof pipelineStepResetRequestSchema>;

export const pipelineStepResetResponseSchema = z.object({
  ok: z.literal(true),
  stepId: z.string().min(1),
  dryRun: z.boolean(),
  cascade: z.boolean(),
  /** preview (dryRun) или подтверждение publish (apply). */
  countsByStep: z.record(z.record(z.number())),
  eventId: z.string().uuid().optional(),
  correlationId: z.string().min(1).optional(),
});
export type PipelineStepResetResponse = z.infer<typeof pipelineStepResetResponseSchema>;

export const pipelineTopologyNodeSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["source", "queue"]),
  pipelineKey: z.string().min(1),
  label: z.string().optional(),
  enabled: z.boolean(),
  phases: z.array(
    z.object({
      id: z.string(),
      scope: z.string(),
      enabled: z.boolean(),
      order: z.number().int(),
    }),
  ),
  queueDepth: z
    .object({
      pending: z.number().int().nonnegative(),
      processing: z.number().int().nonnegative(),
    })
    .nullable(),
  lastStepRun: z
    .object({
      id: z.string(),
      status: z.string(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
    })
    .nullable(),
  resetsHandler: z.string().nullable(),
});
export type PipelineTopologyNode = z.infer<typeof pipelineTopologyNodeSchema>;

export const pipelineTopologyEdgeSchema = z.object({
  fromStepId: z.string().min(1),
  toStepId: z.string().min(1),
  key: z.string().min(1),
  /** true, если edge подавляется isolate-прогоном from-step. */
  suppressed: z.boolean().default(false),
});
export type PipelineTopologyEdge = z.infer<typeof pipelineTopologyEdgeSchema>;

export const pipelineTopologyResponseSchema = z.object({
  version: z.literal(1),
  nodes: z.array(pipelineTopologyNodeSchema),
  edges: z.array(pipelineTopologyEdgeSchema),
  /** Активный isolate stepId (если есть running isolated step run), иначе null. */
  isolateStepId: z.string().nullable(),
  capturedAt: z.string().datetime(),
});
export type PipelineTopologyResponse = z.infer<typeof pipelineTopologyResponseSchema>;
