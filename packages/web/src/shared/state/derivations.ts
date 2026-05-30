import type { MapRegionSnapshot, StateLevel, Warning } from "@radar/shared";
import { LEVEL_COLORS, LEVEL_LABELS } from "../config/mapConfig.service";
import type { DonutSegment } from "../ds/Donut";

const ALL_LEVELS: StateLevel[] = ["red", "orange", "yellow", "green", "grey"];

/** Счётчики регионов по уровню состояния. */
export function countRegionsByLevel(
  regions: Map<string, MapRegionSnapshot>,
): Record<StateLevel, number> {
  const counts: Record<StateLevel, number> = {
    red: 0,
    orange: 0,
    yellow: 0,
    green: 0,
    grey: 0,
  };
  for (const region of regions.values()) {
    counts[region.stateLevel]++;
  }
  return counts;
}

/** Сегменты для donut-диаграммы распределения уровней. */
export function levelDonutSegments(
  counts: Record<StateLevel, number>,
): DonutSegment[] {
  return ALL_LEVELS.map((level) => ({
    label: LEVEL_LABELS[level],
    value: counts[level],
    color: LEVEL_COLORS[level],
  }));
}

/** Топ-N регионов по activity (убывание). */
export function topRegionsByActivity(
  regions: Map<string, MapRegionSnapshot>,
  limit = 10,
): MapRegionSnapshot[] {
  return [...regions.values()]
    .filter((r) => r.activity > 0)
    .sort((a, b) => b.activity - a.activity)
    .slice(0, limit);
}

/** Число активных регионов (stateLevel ≠ grey). */
export function countActiveRegions(
  regions: Map<string, MapRegionSnapshot>,
): number {
  return [...regions.values()].filter((r) => r.stateLevel !== "grey").length;
}

/** Число активных мест (stateLevel ≠ grey). */
export function countActivePlaces(
  places: Map<string, { stateLevel: StateLevel }>,
): number {
  return [...places.values()].filter((p) => p.stateLevel !== "grey").length;
}

/**
 * Бакеты событий по времени для sparkline.
 * Делит окно warnings на bucketCount интервалов.
 */
export function warningsTimeBuckets(
  warnings: Warning[],
  bucketCount = 24,
): number[] {
  if (warnings.length === 0) return Array(bucketCount).fill(0);

  const times = warnings.map((w) => new Date(w.eventAt).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const range = maxT - minT || 1;
  const bucketMs = range / bucketCount;

  const buckets = Array(bucketCount).fill(0);
  for (const t of times) {
    const idx = Math.min(
      bucketCount - 1,
      Math.floor((t - minT) / bucketMs),
    );
    buckets[idx]++;
  }
  return buckets;
}

/** Форматирует возраст ISO-даты в человекочитаемый вид. */
export function formatAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "только что";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}с назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}м назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}ч назад`;
  return `${Math.floor(hr / 24)}д назад`;
}
