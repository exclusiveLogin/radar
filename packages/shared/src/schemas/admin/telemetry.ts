/**
 * ---
 * layer: shared
 * kind: schema
 * domain: admin
 * tooling: zod
 * purpose: Телеметрия процессов (API + worker) для дашборда наблюдаемости.
 * ---
 */
import { z } from "zod";
import {
  processMetricsSchema,
  workerStatusResponseSchema,
} from "../worker-status";

/** Снимок процесса API (heap/cpu/uptime) + pid. */
export const apiProcessTelemetrySchema = z.object({
  pid: z.number().int(),
  startedAt: z.string().datetime(),
  process: processMetricsSchema,
});

/** Сводная телеметрия: API-процесс + worker (probe + БД-подсказки). */
export const adminTelemetrySchema = z.object({
  capturedAt: z.string().datetime(),
  api: apiProcessTelemetrySchema,
  worker: workerStatusResponseSchema,
});

export type ApiProcessTelemetry = z.infer<typeof apiProcessTelemetrySchema>;
export type AdminTelemetry = z.infer<typeof adminTelemetrySchema>;
