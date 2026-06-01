/**
 * SSOT пофайльного слияния вклада энричера в накопитель (ADR-003).
 *
 * Накопитель — карта `поле → { value, source, trust, precision }`. Вклад фазы
 * (namespace энричеров после MergeStep) сводится сюда по правилу:
 * - пустое поле — заполняется;
 * - занятое — перезаписывается только более «сильным» вкладом
 *   (выше precision-ранг; при равенстве — выше trust; затем детерминированный
 *   тай-брейк по источнику).
 *
 * Свойства (инвариант ADR-003): merge идемпотентен (повтор вклада — no-op) и
 * независим от порядка (любой порядок проходов даёт один накопитель). Чистая
 * функция без побочных эффектов — возвращает новый накопитель.
 */
import { PRECISION_RANK } from "../schemas/enrichment/provenance";
import type { FieldProvenance, ProvenanceMeta } from "../schemas/enrichment/provenance";

export type ProvenanceAccumulator = Record<string, FieldProvenance<unknown>>;

/**
 * Сильнее ли вклад текущего значения поля.
 * Тай-брейк по источнику делает результат независимым от порядка применения.
 */
function isStronger(candidate: ProvenanceMeta, current: ProvenanceMeta): boolean {
  const candRank = PRECISION_RANK[candidate.precision];
  const currentRank = PRECISION_RANK[current.precision];
  if (candRank !== currentRank) return candRank > currentRank;
  if (candidate.trust !== current.trust) return candidate.trust > current.trust;
  return candidate.source > current.source;
}

/** Сводит вклад в накопитель пофайльно по precision+trust (см. модульный комментарий). */
export function mergeContribution(
  accumulator: ProvenanceAccumulator,
  contribution: ProvenanceAccumulator,
): ProvenanceAccumulator {
  const next: ProvenanceAccumulator = { ...accumulator };
  for (const [field, candidate] of Object.entries(contribution)) {
    const current = next[field];
    if (!current || isStronger(candidate, current)) {
      next[field] = candidate;
    }
  }
  return next;
}
