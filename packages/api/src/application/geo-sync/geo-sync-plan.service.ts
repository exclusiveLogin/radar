import type { AliasDraft, IGeoSourceProvider, IPlaceAliasRepository, IPlaceRepository, IRegionRepository, PlaceDraft, RegionDraft } from "@radar/shared";
import { diffAliases, diffPlaces, diffRegions, normalizeName } from "./diff-engine";

export type GeoSyncPlan = {
  sourceId: string;
  sourceRevision: string;
  region: ReturnType<typeof diffRegions>["stats"];
  place: ReturnType<typeof diffPlaces>["stats"];
  alias: ReturnType<typeof diffAliases>["stats"];
  sample: {
    region: ReturnType<typeof diffRegions>["sample"];
    place: ReturnType<typeof diffPlaces>["sample"];
    alias: ReturnType<typeof diffAliases>["sample"];
  };
};

export class GeoSyncPlanService {
  constructor(
    private readonly provider: IGeoSourceProvider,
    private readonly regions: IRegionRepository,
    private readonly places: IPlaceRepository,
    private readonly aliases: IPlaceAliasRepository,
  ) {}

  /** Maps active region rows from storage into draft representation. */
  private toRegionDrafts(rows: Awaited<ReturnType<IRegionRepository["listActive"]>>): RegionDraft[] {
    return rows.map((row) => ({
      fiasId: row.fiasId,
      kladrId: row.kladrId,
      iso: row.iso,
      name: row.name,
      nameWithType: row.nameWithType,
      shortName: row.shortName,
      federalDistrict: row.federalDistrict,
      frontRegion: row.frontRegion,
      borderRegion: row.borderRegion,
      geometryArtifactKey: row.geometryArtifactKey,
      sourceMeta: row.sourceMeta,
    }));
  }

  /** Maps active place rows from storage into draft representation. */
  private toPlaceDrafts(rows: Awaited<ReturnType<IPlaceRepository["listActive"]>>): PlaceDraft[] {
    return rows.map((row) => ({
      regionCode: row.regionId,
      kind: row.kind,
      name: row.name,
      nameWithType: row.nameWithType,
      fiasId: row.fiasId,
      kladrId: row.kladrId,
      oktmo: row.oktmo,
      geometryArtifactKey: row.geometryArtifactKey,
    }));
  }

  /** Maps active alias rows from storage into draft representation. */
  private toAliasDrafts(rows: Awaited<ReturnType<IPlaceAliasRepository["listActive"]>>): AliasDraft[] {
    return rows.map((row) => ({
      targetKind: row.targetKind,
      targetExternalKey:
        row.targetKind === "region"
          ? `region:${row.regionId ?? ""}`
          : `place:${row.placeId ?? ""}`,
      alias: row.alias,
      source: row.source ?? "auto",
    }));
  }

  /** Adds normalized place-name variants to improve diff for non-FIAS rows. */
  private toNormalizedPlaceDrafts(rows: Awaited<ReturnType<IPlaceRepository["listActive"]>>): PlaceDraft[] {
    return rows.map((row) => ({
      regionCode: row.regionId,
      kind: row.kind,
      name: normalizeName(row.name),
      nameWithType: row.nameWithType,
      fiasId: row.fiasId,
      kladrId: row.kladrId,
      oktmo: row.oktmo,
      geometryArtifactKey: row.geometryArtifactKey,
    }));
  }

  /** Loads and prepares current storage state for region/place/alias diffing. */
  private async loadCurrentDrafts(): Promise<{
    regions: RegionDraft[];
    places: PlaceDraft[];
    aliases: AliasDraft[];
  }> {
    const [currentRegionsRaw, currentPlacesRaw, currentAliasesRaw] = await Promise.all([
      this.regions.listActive(),
      this.places.listActive(),
      this.aliases.listActive(),
    ]);

    const places = this.toPlaceDrafts(currentPlacesRaw);
    places.push(...this.toNormalizedPlaceDrafts(currentPlacesRaw));

    return {
      regions: this.toRegionDrafts(currentRegionsRaw),
      places,
      aliases: this.toAliasDrafts(currentAliasesRaw),
    };
  }

  /** Calculates dry-run sync diff between provider snapshot and current state. */
  async plan(): Promise<GeoSyncPlan> {
    const snapshot = await this.provider.loadSnapshot();
    const current = await this.loadCurrentDrafts();

    const regionDiff = diffRegions(current.regions, snapshot.regions);
    const placeDiff = diffPlaces(current.places, snapshot.places);
    const aliasDiff = diffAliases(current.aliases, snapshot.aliases);

    return {
      sourceId: snapshot.sourceId,
      sourceRevision: snapshot.sourceRevision,
      region: regionDiff.stats,
      place: placeDiff.stats,
      alias: aliasDiff.stats,
      sample: {
        region: regionDiff.sample,
        place: placeDiff.sample,
        alias: aliasDiff.sample,
      },
    };
  }
}
