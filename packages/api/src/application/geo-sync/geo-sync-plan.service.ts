import type { IGeoSourceProvider, IPlaceAliasRepository, IPlaceRepository, IRegionRepository } from "@radar/shared";
import { diffAliases, diffPlaces, diffRegions } from "./diff-engine";

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
    const currentRegions = snapshot.regions.flatMap(() => []); // placeholder until read-side queries added
    const currentPlaces = snapshot.places.flatMap(() => []);
    const currentAliases = snapshot.aliases.flatMap(() => []);

    // Touch repositories so constructor deps are meaningful in this milestone.
    await this.regions.findByCode("__noop__");
    await this.places.findById("00000000-0000-0000-0000-000000000000");
    await this.aliases.findByAlias("__noop__");

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
