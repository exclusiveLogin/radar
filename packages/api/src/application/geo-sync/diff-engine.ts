import type { AliasDraft, PlaceDraft, RegionDraft } from "@radar/shared";

export type DiffStats = {
  added: number;
  updated: number;
  reactivated: number;
  deactivated: number;
  noop: number;
};

export type DiffReport<T> = {
  stats: DiffStats;
  toUpsert: T[];
  sample: Array<{ key: string; action: keyof DiffStats }>;
};

const emptyStats = (): DiffStats => ({
  added: 0,
  updated: 0,
  reactivated: 0,
  deactivated: 0,
  noop: 0,
});

export function diffRegions(
  current: RegionDraft[],
  expected: RegionDraft[],
): DiffReport<RegionDraft> {
  const map = new Map<string, RegionDraft>();
  for (const row of current) {
    map.set(row.fiasId ?? row.iso ?? row.name.toLowerCase(), row);
  }
  const stats = emptyStats();
  const toUpsert: RegionDraft[] = [];
  const sample: Array<{ key: string; action: keyof DiffStats }> = [];
  for (const row of expected) {
    const key = row.fiasId ?? row.iso ?? row.name.toLowerCase();
    const currentRow = map.get(key);
    if (!currentRow) {
      stats.added += 1;
      toUpsert.push(row);
      sample.push({ key, action: "added" });
      continue;
    }
    const semanticEqual =
      currentRow.name === row.name &&
      currentRow.frontRegion === row.frontRegion &&
      currentRow.borderRegion === row.borderRegion;
    if (semanticEqual) {
      stats.noop += 1;
      continue;
    }
    stats.updated += 1;
    toUpsert.push(row);
    sample.push({ key, action: "updated" });
  }
  return { stats, toUpsert, sample: sample.slice(0, 20) };
}

export function diffPlaces(
  current: PlaceDraft[],
  expected: PlaceDraft[],
): DiffReport<PlaceDraft> {
  const map = new Map<string, PlaceDraft>();
  for (const row of current) {
    map.set(row.fiasId ?? `${row.regionCode}:${row.kind}:${row.name.toLowerCase()}`, row);
  }
  const stats = emptyStats();
  const toUpsert: PlaceDraft[] = [];
  const sample: Array<{ key: string; action: keyof DiffStats }> = [];
  for (const row of expected) {
    const key = row.fiasId ?? `${row.regionCode}:${row.kind}:${row.name.toLowerCase()}`;
    const currentRow = map.get(key);
    if (!currentRow) {
      stats.added += 1;
      toUpsert.push(row);
      sample.push({ key, action: "added" });
      continue;
    }
    const semanticEqual =
      currentRow.name === row.name &&
      currentRow.regionCode === row.regionCode &&
      currentRow.kind === row.kind;
    if (semanticEqual) {
      stats.noop += 1;
      continue;
    }
    stats.updated += 1;
    toUpsert.push(row);
    sample.push({ key, action: "updated" });
  }
  return { stats, toUpsert, sample: sample.slice(0, 20) };
}

export function diffAliases(
  current: AliasDraft[],
  expected: AliasDraft[],
): DiffReport<AliasDraft> {
  const map = new Map<string, AliasDraft>();
  for (const row of current) {
    map.set(`${row.targetKind}:${row.targetExternalKey}:${row.alias.toLowerCase()}`, row);
  }
  const stats = emptyStats();
  const toUpsert: AliasDraft[] = [];
  const sample: Array<{ key: string; action: keyof DiffStats }> = [];
  for (const row of expected) {
    const key = `${row.targetKind}:${row.targetExternalKey}:${row.alias.toLowerCase()}`;
    const currentRow = map.get(key);
    if (!currentRow) {
      stats.added += 1;
      toUpsert.push(row);
      sample.push({ key, action: "added" });
      continue;
    }
    const semanticEqual = currentRow.source === row.source;
    if (semanticEqual) {
      stats.noop += 1;
      continue;
    }
    stats.updated += 1;
    toUpsert.push(row);
    sample.push({ key, action: "updated" });
  }
  return { stats, toUpsert, sample: sample.slice(0, 20) };
}
