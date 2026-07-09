/**
 * ---
 * layer: shared/schemas
 * domain: observability
 * purpose: HTTP ingest batch для obs-service (POST /obs/v1/ingest/batch).
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

/** Запись materialize-счётчика в batch. */
export const obsIngestMaterializeEntrySchema = z.object({
  pipelineKey: pipelineKeySchema,
  delta: z.number().int().positive().optional().default(1),
});
export type ObsIngestMaterializeEntry = z.infer<
  typeof obsIngestMaterializeEntrySchema
>;

/** Запись trigger-счётчика в batch. */
export const obsIngestTriggerEntrySchema = z.object({
  key: triggerCounterKeySchema,
  delta: z.number().int().positive().optional().default(1),
});
export type ObsIngestTriggerEntry = z.infer<typeof obsIngestTriggerEntrySchema>;

/** Тело POST /obs/v1/ingest/batch. */
export const obsIngestBatchSchema = z.object({
  host: hostSnapshotSchema.optional(),
  executors: z.array(executorSnapshotSchema).optional().default([]),
  workloads: z.array(workloadSnapshotSchema).optional().default([]),
  triggers: z.array(obsIngestTriggerEntrySchema).optional().default([]),
  materialize: z.array(obsIngestMaterializeEntrySchema).optional().default([]),
});
export type ObsIngestBatch = z.infer<typeof obsIngestBatchSchema>;
