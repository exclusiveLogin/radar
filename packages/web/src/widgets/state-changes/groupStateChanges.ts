import type { Warning } from "@radar/shared";

export type StateChangeRegionRef = {
  regionCode?: string;
  regionName?: string;
};

/** Сгруппированная запись ленты: один raw → несколько region_state_history с одним changedAt. */
export type GroupedStateChange = {
  id: string;
  eventAt: string;
  stateLevel: Warning["stateLevel"];
  title: string;
  text?: string;
  regions: StateChangeRegionRef[];
};

/** Ключ пачки: одна проекция MessageParsed пишет history с одним changedAt и reason. */
function batchKey(row: Warning): string {
  return `${row.eventAt}|${row.stateLevel ?? ""}|${row.title}|${row.text ?? ""}`;
}

function pushRegion(
  regions: StateChangeRegionRef[],
  row: Warning,
): StateChangeRegionRef[] {
  if (!row.regionCode) return regions;
  if (regions.some((r) => r.regionCode === row.regionCode)) return regions;
  return [
    ...regions,
    { regionCode: row.regionCode, regionName: row.regionName },
  ];
}

/** Склеивает warning-строки одного raw/проекции в одну карточку. */
export function groupStateChanges(rows: Warning[]): GroupedStateChange[] {
  const byBatch = new Map<string, GroupedStateChange>();

  for (const row of rows) {
    const key = batchKey(row);
    const existing = byBatch.get(key);
    if (existing) {
      existing.regions = pushRegion(existing.regions, row);
      continue;
    }
    byBatch.set(key, {
      id: row.id,
      eventAt: row.eventAt,
      stateLevel: row.stateLevel,
      title: row.title,
      text: row.text,
      regions: pushRegion([], row),
    });
  }

  return [...byBatch.values()].sort(
    (a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime(),
  );
}

/** Подпись заголовка: все регионы пачки. */
export function formatGroupedRegionsLabel(regions: StateChangeRegionRef[]): string {
  const names = regions
    .map((r) => r.regionName ?? r.regionCode)
    .filter((value): value is string => Boolean(value));
  if (names.length === 0) return "—";
  return names.join(" · ");
}
