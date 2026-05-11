import type { AliasDraft, GeoProviderSnapshot, IGeoSourceProvider, PlaceDraft, RegionDraft } from "@radar/shared";
import { normalizeName } from "./geo-provider-utils";

/** Deduplicates rows by stable string key while preserving first occurrence. */
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

  /** Loads snapshots from all configured providers in parallel. */
  private async loadProviderSnapshots(): Promise<GeoProviderSnapshot[]> {
    return Promise.all(this.providers.map((provider) => provider.loadSnapshot()));
  }

  /** Builds combined source identity metadata for composite snapshot. */
  private buildSourceMeta(snapshots: GeoProviderSnapshot[]): {
    sourceId: string;
    sourceRevision: string;
  } {
    return {
      sourceId: snapshots.map((snapshot) => snapshot.sourceId).join("+"),
      sourceRevision: snapshots.map((snapshot) => snapshot.sourceRevision).join("|"),
    };
  }

  /** Merges provider snapshots into single deduplicated geo snapshot. */
  async loadSnapshot(): Promise<GeoProviderSnapshot> {
    const snapshots = await this.loadProviderSnapshots();
    const sourceMeta = this.buildSourceMeta(snapshots);
    const regions = dedupeByKey<RegionDraft>(
      snapshots.flatMap((s) => s.regions),
      (row) => row.fiasId ?? row.iso ?? normalizeName(row.name),
    );
    const places = dedupeByKey<PlaceDraft>(
      snapshots.flatMap((s) => s.places),
      (row) => row.fiasId ?? `${row.regionCode}:${row.kind}:${normalizeName(row.name)}`,
    );
    const aliases = dedupeByKey<AliasDraft>(
      snapshots.flatMap((s) => s.aliases),
      (row) => `${row.targetKind}:${row.targetExternalKey}:${normalizeName(row.alias)}`,
    );

    return {
      sourceId: sourceMeta.sourceId,
      sourceRevision: sourceMeta.sourceRevision,
      regions,
      places,
      aliases,
    };
  }
}
