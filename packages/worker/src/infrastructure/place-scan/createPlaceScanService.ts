import { createHash } from "node:crypto";
import type { IPlaceRepository, IRegionRepository, PlaceScanEntry } from "@radar/shared";
import { placeStem } from "@radar/shared";
import { PlaceScanService } from "../../domain/parse/geo/placeScanService.js";

/** Строит PlaceScanService из БД places + regions metadata. */
export async function createPlaceScanService(deps: {
  places: IPlaceRepository;
  regions: IRegionRepository;
}): Promise<PlaceScanService> {
  const entries = await deps.places.listScanEntries();
  const revision = createHash("sha256")
    .update(JSON.stringify(entries.map((e) => e.placeId).sort()), "utf8")
    .digest("hex")
    .slice(0, 12);
  return new PlaceScanService(entries, revision);
}

/** Маппинг PlaceRecord rows → PlaceScanEntry (для InMemory seed). */
export function toScanEntries(
  places: Array<{
    id: string;
    regionId: string;
    kind: PlaceScanEntry["kind"];
    name: string;
    nameStem?: string;
    nameWithType?: string;
    centroidLat?: number;
    centroidLon?: number;
  }>,
  regionIsoById: Map<string, string>,
): PlaceScanEntry[] {
  return places.map((p) => ({
    placeId: p.id,
    regionId: p.regionId,
    regionIso: regionIsoById.get(p.regionId) ?? p.regionId,
    kind: p.kind,
    name: p.name,
    nameStem: p.nameStem ?? placeStem(p.name),
    nameWithType: p.nameWithType,
    centroidLat: p.centroidLat,
    centroidLon: p.centroidLon,
  }));
}
