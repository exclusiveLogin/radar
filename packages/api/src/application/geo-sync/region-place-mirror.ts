import type {
  IPlaceAliasRepository,
  IPlaceRepository,
  IRegionRepository,
  PlaceRecord,
  RegionRecord,
} from "@radar/shared";
import { randomUUID } from "node:crypto";

/** Строит place(kind=region) — зеркало строки словаря regions. */
export function toRegionPlaceRecord(region: RegionRecord, placeId?: string): PlaceRecord {
  return {
    id: placeId ?? randomUUID(),
    regionId: region.id,
    kind: "region",
    name: region.name,
    nameWithType: region.nameWithType,
    fiasId: region.fiasId,
    kladrId: region.kladrId,
    geometryArtifactKey: region.geometryArtifactKey,
    centroidLat: region.centroidLat,
    centroidLon: region.centroidLon,
    bbox: region.bbox,
    lastSourceRevision: region.lastSourceRevision,
    trustState: "verified",
    isTrusted: true,
    trustScore: 1,
    evidenceProviders: ["catalog"],
  };
}

/** После upsert regions: place(kind=region) + канонические алиасы (поиск по region_id). */
export async function syncRegionCanonicalPlaces(
  regions: IRegionRepository,
  places: IPlaceRepository,
  aliases: IPlaceAliasRepository,
): Promise<Map<string, string>> {
  const regionPlaceByRegionId = new Map<string, string>();
  const active = await regions.listActive();

  for (const region of active) {
    const existing = await places.findRegionPlaceByRegionId(region.id);
    const mirror = toRegionPlaceRecord(region, existing?.id);
    const placeId = existing?.id ?? mirror.id;
    await places.upsertMany([{ ...mirror, id: placeId }]);
    regionPlaceByRegionId.set(region.id, placeId);

    const names = new Set<string>([region.name]);
    if (region.nameWithType) names.add(region.nameWithType);
    if (region.shortName) names.add(region.shortName);
    for (const alias of names) {
      await aliases.upsertAlias({ placeId, alias, source: "auto" });
    }
  }

  return regionPlaceByRegionId;
}
