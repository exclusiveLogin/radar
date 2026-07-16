/**
 * Приоритетные eventLocationIds из MessageParsed wake.
 * Single-flight evaluate остаётся в scheduleEngine; здесь только порядок batch.
 */
const priorityIds = new Set<string>();

export function offerTrackingWakeIds(ids: string[]): void {
  for (const id of ids) {
    if (id) priorityIds.add(id);
  }
}

/** Забрать и очистить накопленные ids (для приоритета в loadSlice). */
export function takeTrackingWakeIds(): string[] {
  if (priorityIds.size === 0) return [];
  const out = [...priorityIds];
  priorityIds.clear();
  return out;
}