import { z } from "zod";

/** Метрики процесса Node.js (heap/cpu/uptime) для дашбордов телеметрии. */
export const processMetricsSchema = z.object({
  rssBytes: z.number().int().nonnegative(),
  heapUsedBytes: z.number().int().nonnegative(),
  heapTotalBytes: z.number().int().nonnegative(),
  externalBytes: z.number().int().nonnegative(),
  uptimeSec: z.number().nonnegative(),
  cpuUserSec: z.number().nonnegative(),
  cpuSystemSec: z.number().nonnegative(),
});

export type ProcessMetrics = z.infer<typeof processMetricsSchema>;

/** Снимок runtime worker (probe HTTP на WORKER_PROBE_PORT). */
export const workerProbeStatusSchema = z.object({
  workerRole: z.string().optional(),
  status: z.enum(["running", "starting", "stopped"]),
  storageMode: z.string(),
  pid: z.number().int(),
  startedAt: z.string().datetime(),
  heartbeatAt: z.string().datetime(),
  process: processMetricsSchema,
  orchestrator: z.object({
    running: z.boolean(),
    providerCount: z.number().int(),
    bindingCount: z.number().int(),
  }),
  ingest: z.object({
    liveInserted: z.number().int(),
    backfillInserted: z.number().int(),
    lastLiveAt: z.string().datetime().nullable(),
    lastLiveChannelKey: z.string().nullable(),
    lastError: z.string().nullable(),
  }),
});

export type WorkerProbeStatus = z.infer<typeof workerProbeStatusSchema>;

/** Ответ GET /api/worker/status — probe + подсказки из БД. */
export const workerStatusResponseSchema = z.object({
  reachable: z.boolean(),
  probeUrl: z.string(),
  worker: workerProbeStatusSchema.nullable(),
  db: z.object({
    lastProviderHeartbeatAt: z.string().datetime().nullable(),
    liveMessageCount: z.number().int(),
    backfillMessageCount: z.number().int(),
    lastRawPostedAt: z.string().datetime().nullable(),
    lastRawChannelKey: z.string().nullable(),
  }),
});

export type WorkerStatusResponse = z.infer<typeof workerStatusResponseSchema>;
