/**
 * Мажоритарность региона среди place-хитов сообщения (ADR-027).
 * Минорный ISO на фоне явного кластера другого субъекта → штраф в score.
 */

export type RegionHitCount = {
  regionIso: string;
  count: number;
};

/** Подсчёт place-hits по regionIso (пустые коды игнорируются). */
export function countHitsByRegionIso(regionIsos: Array<string | undefined | null>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const iso of regionIsos) {
    if (!iso) continue;
    counts.set(iso, (counts.get(iso) ?? 0) + 1);
  }
  return counts;
}

/**
 * Кандидат минорен, если его регион не входит в «явный кластер»
 * (≥ majorityClusterMin hits) другого региона, а у него самого hits меньше кластера.
 */
export function isMinorityRegionHit(input: {
  candidateRegionIso: string | undefined | null;
  regionHitCounts: Map<string, number>;
  majorityClusterMin: number;
}): boolean {
  const iso = input.candidateRegionIso;
  if (!iso) return false;

  const ownCount = input.regionHitCounts.get(iso) ?? 0;
  let majorityIso: string | null = null;
  let majorityCount = 0;

  for (const [otherIso, count] of input.regionHitCounts) {
    if (count >= input.majorityClusterMin && count > majorityCount) {
      majorityIso = otherIso;
      majorityCount = count;
    }
  }

  if (!majorityIso || majorityIso === iso) return false;
  return ownCount < majorityCount;
}

/** Доминирующий регион (для аудита/LLM-контекста), если есть кластер. */
export function pickMajorityRegionIso(
  regionHitCounts: Map<string, number>,
  majorityClusterMin: number,
): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [iso, count] of regionHitCounts) {
    if (count >= majorityClusterMin && count > bestCount) {
      best = iso;
      bestCount = count;
    }
  }
  return best;
}
