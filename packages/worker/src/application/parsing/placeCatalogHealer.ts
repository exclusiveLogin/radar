import {
  canonicalRegionCode,
  type EventLocation,
  type LocationPrecision,
  type PlaceRecord,
  type RegionRecord,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { isGarbageIngestPlaceName } from "../../domain/parsing/channelCityListPromo.js";
import {
  isPlaceCatalogHealCandidate,
  isVendorCatalogPlace,
  type PlaceCatalogHealScope,
} from "../../domain/parsing/placeCatalogHealRule.js";
import {
  findActivePlaceDuplicateGroups,
  pickCanonicalPlace,
} from "../../domain/parsing/placeCatalogDedup.js";
import type { GeoValidationService } from "./geoValidationService.js";
import type { IPlaceAliasRepository } from "@radar/shared";

export type PlaceCatalogHealAction = "skipped_healthy" | "deprecated" | "merged";

export type PlaceCatalogHealRow = {
  placeId: string;
  placeName: string;
  action: PlaceCatalogHealAction;
  targetPlaceId?: string;
  decision?: string;
};

export type PlaceCatalogHealSummary = {
  scanned: number;
  candidates: number;
  deprecated: number;
  merged: number;
  healthy: number;
  rows: PlaceCatalogHealRow[];
};

export type PlaceCatalogDedupSummary = {
  duplicateGroups: number;
  duplicateRows: number;
  deprecated: number;
  rows: PlaceCatalogHealRow[];
};

function placeKindToPrecision(kind: PlaceRecord["kind"]): LocationPrecision {
  switch (kind) {
    case "city":
      return "city";
    case "district":
      return "district";
    case "settlement":
      return "settlement";
    case "region":
      return "region";
    default:
      return "locality";
  }
}

/** Синтетическая EventLocation для прогона существующего place через validate(). */
export function buildCatalogHealEventLocation(
  place: PlaceRecord,
  region: RegionRecord,
): EventLocation {
  return {
    regionId: region.id,
    regionCode: canonicalRegionCode(region),
    placeId: place.id,
    placeName: place.name,
    placeFias: place.fiasId,
    entityKind: "place",
    precision: placeKindToPrecision(place.kind),
    lat: place.centroidLat,
    lon: place.centroidLon,
    source: "db",
  };
}

/** rawText для heal: только имя — region резолвит SSOT validate (catalog → anchor → explicit). */
export function buildCatalogHealRawQuery(place: PlaceRecord, region: RegionRecord): string {
  return `${place.name}, ${region.name}`;
}

/** Деактивирует битый place и снимает geo-очередь. */
export async function deprecateCatalogPlace(
  dataSource: DataSource,
  placeId: string,
): Promise<void> {
  await dataSource.query(
    `UPDATE places
     SET is_active = false,
         deprecated_at = now(),
         trust_state = 'rejected',
         updated_at = now()
     WHERE id = $1`,
    [placeId],
  );
  await dataSource.query(
    `UPDATE place_aliases
     SET is_active = false, deprecated_at = now()
     WHERE place_id = $1 AND is_active = true`,
    [placeId],
  );
  await dataSource.query(
    `DELETE FROM place_enrichment_jobs WHERE place_id = $1`,
    [placeId],
  );
  await dataSource.query(
    `DELETE FROM place_status_read_model WHERE place_id = $1`,
    [placeId],
  );
}

export type PurgeGarbagePlacesSummary = {
  scanned: number;
  purged: number;
  rows: Array<{ placeId: string; placeName: string }>;
};

/** Деактивирует active places с мусорным именем (футер канала, не топоним). */
export async function purgeGarbageCatalogPlaces(input: {
  dataSource: DataSource;
  places: PlaceRecord[];
  dryRun: boolean;
}): Promise<PurgeGarbagePlacesSummary> {
  const summary: PurgeGarbagePlacesSummary = {
    scanned: input.places.length,
    purged: 0,
    rows: [],
  };

  for (const place of input.places) {
    if (place.kind === "region" || isVendorCatalogPlace(place)) continue;
    if (!isGarbageIngestPlaceName(place.name)) continue;

    summary.purged += 1;
    summary.rows.push({ placeId: place.id, placeName: place.name });
    if (!input.dryRun) {
      await deprecateCatalogPlace(input.dataSource, place.id);
    }
  }

  return summary;
}

/**
 * Прогон active places через GeoValidationService.
 * rejected → deprecate; matched другой id → deprecate; matched self → ok.
 */
export async function runPlaceCatalogHeal(input: {
  dataSource: DataSource;
  validation: GeoValidationService;
  regionsById: Map<string, RegionRecord>;
  places: PlaceRecord[];
  scope: PlaceCatalogHealScope;
  dryRun: boolean;
}): Promise<PlaceCatalogHealSummary> {
  const summary: PlaceCatalogHealSummary = {
    scanned: 0,
    candidates: 0,
    deprecated: 0,
    merged: 0,
    healthy: 0,
    rows: [],
  };

  for (const place of input.places) {
    summary.scanned += 1;
    if (!isPlaceCatalogHealCandidate(place, input.scope)) {
      continue;
    }
    summary.candidates += 1;

    const region = input.regionsById.get(place.regionId);
    if (!region) {
      summary.deprecated += 1;
      summary.rows.push({
        placeId: place.id,
        placeName: place.name,
        action: "deprecated",
        decision: "rejected:no_region",
      });
      if (!input.dryRun) {
        await deprecateCatalogPlace(input.dataSource, place.id);
      }
      continue;
    }

    const location = buildCatalogHealEventLocation(place, region);
    const rawQuery = buildCatalogHealRawQuery(place, region);
    const result = await input.validation.validate(rawQuery, location, {
      providerHint: "system",
      catalogHeal: true,
    });

    if (result.decision === "rejected") {
      summary.deprecated += 1;
      summary.rows.push({
        placeId: place.id,
        placeName: place.name,
        action: "deprecated",
        decision: "rejected",
      });
      if (!input.dryRun) {
        await deprecateCatalogPlace(input.dataSource, place.id);
      }
      continue;
    }

    const resolvedPlaceId = result.location?.placeId;
    if (result.decision === "matched_existing" && resolvedPlaceId && resolvedPlaceId !== place.id) {
      summary.merged += 1;
      summary.rows.push({
        placeId: place.id,
        placeName: place.name,
        action: "merged",
        targetPlaceId: resolvedPlaceId,
        decision: "matched_existing",
      });
      if (!input.dryRun) {
        await deprecateCatalogPlace(input.dataSource, place.id);
      }
      continue;
    }

    summary.healthy += 1;
    summary.rows.push({
      placeId: place.id,
      placeName: place.name,
      action: "skipped_healthy",
      decision: result.decision,
    });
  }

  return summary;
}

/**
 * Dedup: в каждой группе (region + normalized name) оставляем канон, остальные deprecate.
 */
export async function runPlaceCatalogDedup(input: {
  dataSource: DataSource;
  aliases: IPlaceAliasRepository;
  places: PlaceRecord[];
  dryRun: boolean;
}): Promise<PlaceCatalogDedupSummary> {
  const groups = findActivePlaceDuplicateGroups(input.places);
  const summary: PlaceCatalogDedupSummary = {
    duplicateGroups: groups.size,
    duplicateRows: 0,
    deprecated: 0,
    rows: [],
  };

  for (const group of groups.values()) {
    summary.duplicateRows += group.length;
    const canonical = pickCanonicalPlace(group);

    for (const duplicate of group) {
      if (duplicate.id === canonical.id) continue;

      summary.deprecated += 1;
      summary.rows.push({
        placeId: duplicate.id,
        placeName: duplicate.name,
        action: "merged",
        targetPlaceId: canonical.id,
        decision: `dedup→${canonical.name}`,
      });

      if (input.dryRun) continue;

      await input.aliases.upsertAlias({
        placeId: canonical.id,
        alias: duplicate.name,
        source: "auto",
      });
      await deprecateCatalogPlace(input.dataSource, duplicate.id);
    }
  }

  return summary;
}
