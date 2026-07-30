import { collectDefaultMetrics, Registry } from "prom-client";

export type NodeRuntimeMetricLabels = Readonly<Record<string, string>>;

export type NodeRuntimeMetrics = {
  contentType: string;
  snapshot(): Promise<string>;
};

/**
 * Создаёт изолированный registry стандартных метрик текущего Node.js процесса.
 * Labels позволяют Prometheus различать API и отдельные worker-роли.
 */
export function createNodeRuntimeMetrics(
  labels: NodeRuntimeMetricLabels,
): NodeRuntimeMetrics {
  const registry = new Registry();
  registry.setDefaultLabels(labels);
  collectDefaultMetrics({ register: registry });

  return {
    contentType: registry.contentType,
    snapshot: () => registry.metrics(),
  };
}
