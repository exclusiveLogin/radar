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

  async plan(): Promise<GeoSyncPlan> {
    const snapshot = await this.provider.loadSnapshot();
    const currentRegionsRaw = await this.regions.listActive();
    const currentPlacesRaw = await this.places.listActive();
    const currentAliasesRaw = await this.aliases.listActive();

    const currentRegions: RegionDraft[] = currentRegionsRaw.map((row) => ({
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

    const currentPlaces: PlaceDraft[] = currentPlacesRaw.map((row) => ({
      regionCode: row.regionId,
      kind: row.kind,
      name: row.name,
      nameWithType: row.nameWithType,
      fiasId: row.fiasId,
      kladrId: row.kladrId,
      oktmo: row.oktmo,
      geometryArtifactKey: row.geometryArtifactKey,
    }));

    const currentAliases: AliasDraft[] = currentAliasesRaw.map((row) => ({
      targetKind: row.targetKind,
      targetExternalKey:
        row.targetKind === "region"
          ? `region:${row.regionId ?? ""}`
          : `place:${row.placeId ?? ""}`,
      alias: row.alias,
      source: row.source ?? "auto",
    }));

    // Дополнительно учитываем name+region ключи для places,
    // чтобы diff корректно видел существующие записи без FIAS.
    for (const row of currentPlacesRaw) {
      currentPlaces.push({
        regionCode: row.regionId,
        kind: row.kind,
        name: normalizeName(row.name),
        nameWithType: row.nameWithType,
        fiasId: row.fiasId,
        kladrId: row.kladrId,
        oktmo: row.oktmo,
        geometryArtifactKey: row.geometryArtifactKey,
      });
    }

    const regionDiff = diffRegions(currentRegions, snapshot.regions);
    const placeDiff = diffPlaces(currentPlaces, snapshot.places);
    const aliasDiff = diffAliases(currentAliases, snapshot.aliases);

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
