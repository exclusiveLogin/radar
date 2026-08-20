import { createNodeRuntimeMetrics, type NodeRuntimeMetrics } from "@radar/observability";

let instance: NodeRuntimeMetrics | undefined;

/**
 * Единый Prometheus registry worker-процесса (probe + domain events + transport).
 * Создаётся лениво при первом обращении — один на процесс.
 */
export function getWorkerPrometheusMetrics(): NodeRuntimeMetrics {
  if (!instance) {
    instance = createNodeRuntimeMetrics({
      service: "worker",
      role: process.env.RADAR_WORKER_ROLE?.trim() || "unknown",
    });
  }
  return instance;
}
