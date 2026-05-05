import type { AliasDraft, GeoProviderSnapshot, IGeoSourceProvider, PlaceDraft, RegionDraft } from "@radar/shared";

function dedupeByKey<T>(
  rows: T[],
  keySelector: (row: T) => string,
): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = keySelector(row);
    if (!map.has(key)) {
      map.set(key, row);
    }
  }
  return [...map.values()];
}

export class CompositeGeoProvider implements IGeoSourceProvider {
  constructor(private readonly providers: IGeoSourceProvider[]) {}

  async loadSnapshot(): Promise<GeoProviderSnapshot> {
    const snapshots = await Promise.all(
      this.providers.map((provider) => provider.loadSnapshot()),
    );

    const sourceId = snapshots.map((s) => s.sourceId).join("+");
    const sourceRevision = snapshots.map((s) => s.sourceRevision).join("|");
    const regions = dedupeByKey<RegionDraft>(
      snapshots.flatMap((s) => s.regions),
      (row) => row.fiasId ?? row.iso ?? row.name.toLowerCase(),
    );
    const places = dedupeByKey<PlaceDraft>(
      snapshots.flatMap((s) => s.places),
      (row) => row.fiasId ?? `${row.regionCode}:${row.kind}:${row.name.toLowerCase()}`,
    );
    const aliases = dedupeByKey<AliasDraft>(
      snapshots.flatMap((s) => s.aliases),
      (row) => `${row.targetKind}:${row.targetExternalKey}:${row.alias.toLowerCase()}`,
    );

    return {
      sourceId,
      sourceRevision,
      regions,
      places,
      aliases,
    };
  }
}
