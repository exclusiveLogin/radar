import type { AliasDraft, PlaceDraft, RegionDraft } from "@radar/shared";
import { normalizeGeoText } from "../geo/normalizeText";

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

export function normalizeName(value: string): string {
  return normalizeGeoText(value);
}

export function regionDraftKey(row: RegionDraft): string {
  return row.fiasId ?? row.iso ?? normalizeGeoText(row.name);
}

export function placeDraftKey(row: PlaceDraft): string {
  return row.fiasId ?? `${row.regionCode}:${row.kind}:${normalizeGeoText(row.name)}`;
}

export function aliasDraftKey(row: AliasDraft): string {
  return `${row.targetKind}:${row.targetExternalKey}:${normalizeGeoText(row.alias)}`;
}

export function diffRegions(
  current: RegionDraft[],
  expected: RegionDraft[],
): DiffReport<RegionDraft> {
  const map = new Map<string, RegionDraft>();
  for (const row of current) {
    map.set(regionDraftKey(row), row);
  }
  const stats = emptyStats();
  const toUpsert: RegionDraft[] = [];
  const sample: Array<{ key: string; action: keyof DiffStats }> = [];

  for (const row of expected) {
    const key = regionDraftKey(row);
    const currentRow = map.get(key);
    if (!currentRow) {
      stats.added += 1;
      toUpsert.push(row);
      sample.push({ key, action: "added" });
      continue;
    }

    const semanticEqual =
      currentRow.name === row.name &&
      (currentRow.nameWithType ?? "") === (row.nameWithType ?? "") &&
      (currentRow.kladrId ?? "") === (row.kladrId ?? "") &&
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
    map.set(placeDraftKey(row), row);
  }
  const stats = emptyStats();
  const toUpsert: PlaceDraft[] = [];
  const sample: Array<{ key: string; action: keyof DiffStats }> = [];

  for (const row of expected) {
    const key = placeDraftKey(row);
    const currentRow = map.get(key);
    if (!currentRow) {
      stats.added += 1;
      toUpsert.push(row);
      sample.push({ key, action: "added" });
      continue;
    }

    const semanticEqual =
      currentRow.name === row.name &&
      (currentRow.nameWithType ?? "") === (row.nameWithType ?? "") &&
      currentRow.regionCode === row.regionCode &&
      currentRow.kind === row.kind &&
      (currentRow.kladrId ?? "") === (row.kladrId ?? "") &&
      (currentRow.oktmo ?? "") === (row.oktmo ?? "");
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
    map.set(aliasDraftKey(row), row);
  }
  const stats = emptyStats();
  const toUpsert: AliasDraft[] = [];
  const sample: Array<{ key: string; action: keyof DiffStats }> = [];

  for (const row of expected) {
    const key = aliasDraftKey(row);
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
