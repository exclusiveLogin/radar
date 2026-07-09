import { z } from "zod";

export const workerRuntimeBackfillSchema = z.object({
  enabled: z.boolean().default(true),
  pollMs: z.number().int().positive().default(15_000),
  heartbeatMs: z.number().int().positive().default(15_000),
});

export const workerRuntimeParseDaemonSchema = z.object({
  enabled: z.boolean().default(true),
  pollMs: z.number().int().positive().default(15_000),
});

export const workerRuntimeParseSchema = z.object({
  useWorkerThreads: z.boolean().default(true),
  poolSize: z.number().int().positive().max(8).default(2),
  daemon: workerRuntimeParseDaemonSchema.default({}),
  claimOrder: z.enum(["desc", "asc"]).default("desc"),
  runStaleMs: z.number().int().positive().default(7_200_000),
});

export const workerRuntimeGeoSchema = z.object({
  daemon: z.object({ pollMs: z.number().int().positive().default(15_000) }).default({}),
  orphanRunMs: z.number().int().positive().default(3_600_000),
  runStaleMs: z.number().int().positive().default(7_200_000),
});

export const workerRuntimeTrackingSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().int().positive().default(10_000),
});

export const workerRuntimePhaseSchema = z.object({
  manualPollMs: z.number().int().positive().default(5_000),
  mapSnapshotAfterPhase: z.boolean().default(true),
});

export const workerRuntimeLoggingSchema = z.object({
  verboseParse: z.boolean().default(false),
});

export const workerRuntimeManifestSchema = z.object({
  version: z.literal(1).default(1),
  backfill: workerRuntimeBackfillSchema.default({}),
  parse: workerRuntimeParseSchema.default({}),
  geo: workerRuntimeGeoSchema.default({}),
  tracking: workerRuntimeTrackingSchema.default({}),
  phase: workerRuntimePhaseSchema.default({}),
  logging: workerRuntimeLoggingSchema.default({}),
});

export type WorkerRuntimeManifest = z.infer<typeof workerRuntimeManifestSchema>;

export const DEFAULT_WORKER_RUNTIME_MANIFEST: WorkerRuntimeManifest =
  workerRuntimeManifestSchema.parse({ version: 1 });
