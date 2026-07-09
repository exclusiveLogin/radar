/**
 * ---
 * layer: shared/schemas
 * domain: observability
 * purpose: read-side snapshot для GET /obs/v1/runtime/snapshot и admin discovery.
 * ---
 */
import { z } from "zod";
import { pipelineKeySchema } from "../admin/workbook";
import {
  executorSnapshotSchema,
  hostSnapshotSchema,
  triggerCounterKeySchema,
  workloadSnapshotSchema,
} from "./runtime-snapshot";

/** Trigger-счётчик с накопленным count. */
export const obsTriggerCounterSchema = triggerCounterKeySchema.extend({
  count: z.number().int().nonnegative(),
});
export type ObsTriggerCounter = z.infer<typeof obsTriggerCounterSchema>;

/** Materialize-счётчик с timestamp обновления. */
export const obsMaterializeCounterSchema = z.object({
  pipelineKey: pipelineKeySchema,
  count: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type ObsMaterializeCounter = z.infer<typeof obsMaterializeCounterSchema>;

/** Полный runtime snapshot observability BC. */
export const runtimeObservabilitySnapshotSchema = z.object({
  hosts: z.array(hostSnapshotSchema),
  executors: z.array(executorSnapshotSchema),
  workloads: z.array(workloadSnapshotSchema),
  triggerCounters: z.array(obsTriggerCounterSchema),
  materializeCounters: z.array(obsMaterializeCounterSchema),
  generatedAt: z.string().datetime(),
});
export type RuntimeObservabilitySnapshot = z.infer<
  typeof runtimeObservabilitySnapshotSchema
>;
