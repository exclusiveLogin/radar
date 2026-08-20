/**
 * ---
 * layer: shared/pipeline
 * purpose: Построение графа шагов из манифеста (edges по совпадению emits → trigger.on).
 * ---
 */
import type { PipelineManifest, StepDescriptor } from "./pipelineManifest.schema.js";

export type PipelineGraphEdge = {
  fromStepId: string;
  toStepId: string;
  key: string;
};

export type PipelineGraph = {
  nodes: StepDescriptor[];
  edges: PipelineGraphEdge[];
};

/**
 * Routing key для PipelineStabilized из DSL: первый `*.stabilized` в step.emits.
 * Нет ключа → cascade claim без bus-publish (geo без downstream).
 */
export function stabilizedEmitKeyForPipeline(
  manifest: PipelineManifest,
  pipelineKey: string,
): string | null {
  const step = manifest.steps.find((s) => s.pipelineKey === pipelineKey && s.enabled);
  if (!step) return null;
  return step.emits.find((key) => key.endsWith(".stabilized")) ?? null;
}

/** Статический граф: ребро, если emits шага A пересекается с trigger.on шага B. */
export function buildPipelineGraph(manifest: PipelineManifest): PipelineGraph {
  const nodes = manifest.steps.filter((s) => s.enabled);
  const edges: PipelineGraphEdge[] = [];
  for (const from of nodes) {
    for (const key of from.emits) {
      for (const to of nodes) {
        if (to.id === from.id) continue;
        if (to.trigger.on.includes(key)) {
          edges.push({ fromStepId: from.id, toStepId: to.id, key });
        }
      }
    }
  }
  return { nodes, edges };
}

/** Downstream step ids по исходящим ключам (для isolate suppressed_emits). */
export function downstreamStepIds(
  manifest: PipelineManifest,
  fromStepId: string,
): string[] {
  const graph = buildPipelineGraph(manifest);
  return [...new Set(graph.edges.filter((e) => e.fromStepId === fromStepId).map((e) => e.toStepId))];
}

/**
 * Каскадный порядок reset: потомки сначала (reverse topo от корня).
 * Только шаги с resets.handler.
 */
export function cascadeResetOrder(
  manifest: PipelineManifest,
  rootStepId: string,
): string[] {
  const graph = buildPipelineGraph(manifest);
  const visited = new Set<string>();
  const order: string[] = [];

  function dfs(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    for (const edge of graph.edges.filter((e) => e.fromStepId === id)) {
      dfs(edge.toStepId);
    }
    order.push(id);
  }

  dfs(rootStepId);
  return order.filter((id) => {
    const step = manifest.steps.find((s) => s.id === id);
    return Boolean(step?.resets?.handler);
  });
}
