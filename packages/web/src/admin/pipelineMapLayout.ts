/**
 * ---
 * layer: web/admin
 * purpose: Топо-раскладка pipeline topology (nodes/edges) в колонки по longest-path rank.
 * ---
 */

export type PipelineMapLayoutNode = {
  id: string;
};

export type PipelineMapLayoutEdge = {
  fromStepId: string;
  toStepId: string;
  key: string;
  suppressed?: boolean;
};

export type PipelineMapColumn<T extends PipelineMapLayoutNode> = {
  rank: number;
  nodes: T[];
};

export type PipelineMapLayout<T extends PipelineMapLayoutNode> = {
  columns: PipelineMapColumn<T>[];
  /** Рёбра между существующими нодами (порядок: from, to, key). */
  edges: PipelineMapLayoutEdge[];
};

/**
 * Укоротить routing key для UI: `radar.message.parsed` → `message.parsed`.
 */
export function shortRoutingKey(key: string): string {
  return key.startsWith("radar.") ? key.slice("radar.".length) : key;
}

/**
 * Longest-path layering: rank = 0 у источников; иначе max(pred)+1.
 * Циклы (если появятся) — оставшиеся ноды в последнюю колонку.
 */
export function layoutPipelineColumns<T extends PipelineMapLayoutNode>(
  nodes: readonly T[],
  edges: readonly PipelineMapLayoutEdge[],
): PipelineMapLayout<T> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = nodes.map((n) => n.id);

  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of ids) {
    outgoing.set(id, []);
    indegree.set(id, 0);
  }

  const layoutEdges: PipelineMapLayoutEdge[] = [];
  for (const e of edges) {
    if (!byId.has(e.fromStepId) || !byId.has(e.toStepId)) continue;
    if (e.fromStepId === e.toStepId) continue;
    layoutEdges.push(e);
    outgoing.get(e.fromStepId)!.push(e.toStepId);
    indegree.set(e.toStepId, (indegree.get(e.toStepId) ?? 0) + 1);
  }

  const rank = new Map<string, number>();
  const queue: string[] = [];
  for (const id of ids) {
    if ((indegree.get(id) ?? 0) === 0) {
      rank.set(id, 0);
      queue.push(id);
    }
  }

  // Kahn + longest path
  const remaining = new Map(indegree);
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    const r = rank.get(id) ?? 0;
    for (const to of outgoing.get(id) ?? []) {
      const nextRank = r + 1;
      if ((rank.get(to) ?? -1) < nextRank) rank.set(to, nextRank);
      const left = (remaining.get(to) ?? 1) - 1;
      remaining.set(to, left);
      if (left === 0) queue.push(to);
    }
  }

  // Ноды в цикле / не достигнутые — в хвост
  let maxRank = 0;
  for (const r of rank.values()) maxRank = Math.max(maxRank, r);
  for (const id of ids) {
    if (!rank.has(id)) {
      maxRank += 1;
      rank.set(id, maxRank);
    }
  }

  const columnMap = new Map<number, T[]>();
  for (const id of ids) {
    const r = rank.get(id) ?? 0;
    const list = columnMap.get(r) ?? [];
    list.push(byId.get(id)!);
    columnMap.set(r, list);
  }

  const columns: PipelineMapColumn<T>[] = [...columnMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([r, colNodes]) => ({
      rank: r,
      nodes: [...colNodes].sort((a, b) => a.id.localeCompare(b.id)),
    }));

  const edgesSorted = [...layoutEdges].sort((a, b) => {
    const c = a.fromStepId.localeCompare(b.fromStepId);
    if (c !== 0) return c;
    const d = a.toStepId.localeCompare(b.toStepId);
    if (d !== 0) return d;
    return a.key.localeCompare(b.key);
  });

  return { columns, edges: edgesSorted };
}
