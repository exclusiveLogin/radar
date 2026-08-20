import { createNodeRuntimeMetrics, type NodeRuntimeMetrics } from "@radar/observability";

/** Единый registry API: node defaults + obs bridge + HTTP RED. */
export const apiPrometheusMetrics: NodeRuntimeMetrics = createNodeRuntimeMetrics({
  service: "api",
  role: "api",
});
