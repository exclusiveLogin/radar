/**
 * ---
 * layer: shared/schemas
 * domain: observability
 * purpose: DTO снимков runtime (host/executor/workload/counters) для IObservabilityRecorder.
 * ---
 */
import { z } from "zod";
import { pipelineKeySchema } from "../admin/workbook";

/** Рантайм pipeline: legacy-демон или runner platform. */
export const obsPipelineRuntimeSchema = z.enum(["legacy", "runner-platform"]);
export type ObsPipelineRuntime = z.infer<typeof obsPipelineRuntimeSchema>;

/** Тип исполнителя: OS-процесс, поток или внешний адаптер. */
export const executorKindSchema = z.enum(["process", "thread", "external"]);
export type ExecutorKind = z.infer<typeof executorKindSchema>;

/** Статус исполнителя для discovery UI. */
export const executorStatusSchema = z.enum([
  "idle",
  "busy",
  "starting",
  "stopped",
  "error",
]);
export type ExecutorStatus = z.infer<typeof executorStatusSchema>;

/** ODP badge: какой runtime у каждого pipeline на хосте. */
export const odpRuntimeEntrySchema = z.object({
  pipelineKey: z.string(),
  label: z.string(),
  runtime: obsPipelineRuntimeSchema,
});
export type OdpRuntimeEntry = z.infer<typeof odpRuntimeEntrySchema>;

/** Снимок worker-хоста (role-split или монолит). */
export const hostSnapshotSchema = z.object({
  hostId: z.string(),
  role: z.string(),
  startedAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  odpRuntime: z.array(odpRuntimeEntrySchema),
  metrics: z.record(z.string(), z.unknown()).optional(),
});
export type HostSnapshot = z.infer<typeof hostSnapshotSchema>;

/** Снимок исполнителя (process/thread) на хосте. */
export const executorSnapshotSchema = z.object({
  executorId: z.string(),
  hostId: z.string(),
  kind: executorKindSchema,
  parentId: z.string().nullable().optional(),
  lastSeenAt: z.string().datetime(),
  status: executorStatusSchema,
  metrics: z.record(z.string(), z.unknown()).optional(),
});
export type ExecutorSnapshot = z.infer<typeof executorSnapshotSchema>;

/** Статусы workload в obs write-path (running|paused|stopped|idle). */
export const obsWorkloadStatusSchema = z.enum(["running", "paused", "stopped", "idle"]);
export type ObsWorkloadStatus = z.infer<typeof obsWorkloadStatusSchema>;

/** Снимок workload (parse/tracking/geo-enrich mill). */
export const workloadSnapshotSchema = z.object({
  workloadId: z.string(),
  hostId: z.string(),
  pipelineKey: pipelineKeySchema,
  runtime: obsPipelineRuntimeSchema,
  status: obsWorkloadStatusSchema,
  lastTickAt: z.string().datetime().nullable().optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
});
export type WorkloadSnapshot = z.infer<typeof workloadSnapshotSchema>;

/** Ключ счётчика триггеров (event × pipeline × source). */
export const triggerCounterKeySchema = z.object({
  pipelineKey: pipelineKeySchema,
  eventType: z.string(),
  source: z.string(),
});
export type TriggerCounterKey = z.infer<typeof triggerCounterKeySchema>;
