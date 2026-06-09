import type { PlaceRecord, PlaceEnrichmentProvider } from "@radar/shared";
import type { DataSource } from "typeorm";
import { isGarbageIngestPlaceName } from "../../domain/parsing/channelCityListPromo.js";
import {
  enrichmentMissError,
  isEnrichmentJobMiss,
} from "../../domain/parsing/placeEnrichmentStatus.js";
import { isVendorCatalogPlace } from "../../domain/parsing/placeCatalogHealRule.js";
import { deprecateCatalogPlace } from "./placeCatalogHealer.js";

export type PlaceJobSnapshot = {
  provider: PlaceEnrichmentProvider;
  status: string;
  lastError?: string;
};

export type PlaceSweepFilters = {
  onlyMiss?: boolean;
  emptyDadata?: boolean;
  emptyNominatim?: boolean;
  noCoords?: boolean;
  unverified?: boolean;
  garbage?: boolean;
  bothMiss?: boolean;
  /** Нет coords и ни один провайдер не verified (не vendor). */
  unenriched?: boolean;
};

export type PlaceSweepRow = {
  placeId: string;
  placeName: string;
  regionName: string;
  trustState: string;
  evidenceProviders: string[];
  hasCoords: boolean;
  jobs: PlaceJobSnapshot[];
  reasons: string[];
};

export type PlaceSweepSummary = {
  scanned: number;
  matched: number;
  pruned: number;
  deleted: number;
  deprecated: number;
  skippedProtected: number;
  rows: PlaceSweepRow[];
};

const GEO_PROVIDERS: PlaceEnrichmentProvider[] = ["dadata", "nominatim"];

function hasProviderEvidence(place: PlaceRecord, provider: PlaceEnrichmentProvider): boolean {
  return (place.evidenceProviders ?? []).includes(provider);
}

function jobOf(
  jobs: PlaceJobSnapshot[],
  provider: PlaceEnrichmentProvider,
): PlaceJobSnapshot | undefined {
  return jobs.find((row) => row.provider === provider);
}

function isProviderMiss(
  place: PlaceRecord,
  jobs: PlaceJobSnapshot[],
  provider: PlaceEnrichmentProvider,
): boolean {
  const job = jobOf(jobs, provider);
  if (job && (job.status === "failed" || isEnrichmentJobMiss(job.lastError))) {
    return true;
  }
  if (!hasProviderEvidence(place, provider)) {
    return true;
  }
  return false;
}

function isUnenrichedPlace(place: PlaceRecord, jobs: PlaceJobSnapshot[]): boolean {
  if (isVendorCatalogPlace(place) || place.kind === "region") {
    return false;
  }
  const hasCoords = place.centroidLat != null && place.centroidLon != null;
  if (hasCoords && place.isTrusted) {
    return false;
  }
  const dadataMiss = isProviderMiss(place, jobs, "dadata");
  const nominatimMiss = isProviderMiss(place, jobs, "nominatim");
  const onlyCatalog =
    (place.evidenceProviders ?? []).length <= 1
    && (place.evidenceProviders ?? [])[0] === "catalog";
  return (dadataMiss && nominatimMiss) || (onlyCatalog && !hasCoords);
}

/** Собирает причины попадания под фильтры sweep. */
export function classifyPlaceSweepRow(
  place: PlaceRecord,
  regionName: string,
  jobs: PlaceJobSnapshot[],
  filters: PlaceSweepFilters,
): PlaceSweepRow | null {
  if (place.kind === "region" || isVendorCatalogPlace(place)) {
    return null;
  }

  const reasons: string[] = [];
  const hasCoords = place.centroidLat != null && place.centroidLon != null;
  const dadataJob = jobOf(jobs, "dadata");
  const nominatimJob = jobOf(jobs, "nominatim");
  const dadataMiss = dadataJob
    ? dadataJob.status === "failed" || isEnrichmentJobMiss(dadataJob.lastError)
    : !hasProviderEvidence(place, "dadata");
  const nominatimMiss = nominatimJob
    ? nominatimJob.status === "failed" || isEnrichmentJobMiss(nominatimJob.lastError)
    : !hasProviderEvidence(place, "nominatim");

  const checks: Array<{ enabled: boolean; reason: string; ok: boolean }> = [
    {
      enabled: Boolean(filters.garbage),
      reason: "garbage",
      ok: isGarbageIngestPlaceName(place.name),
    },
    {
      enabled: Boolean(filters.onlyMiss),
      reason: "miss",
      ok: dadataMiss || nominatimMiss,
    },
    {
      enabled: Boolean(filters.emptyDadata),
      reason: "empty_dadata",
      ok: dadataMiss || !hasProviderEvidence(place, "dadata"),
    },
    {
      enabled: Boolean(filters.emptyNominatim),
      reason: "empty_nominatim",
      ok: nominatimMiss || !hasProviderEvidence(place, "nominatim"),
    },
    {
      enabled: Boolean(filters.noCoords),
      reason: "no_coords",
      ok: !hasCoords,
    },
    {
      enabled: Boolean(filters.unverified),
      reason: "unverified",
      ok: !place.isTrusted || place.trustState === "unverified",
    },
    {
      enabled: Boolean(filters.bothMiss),
      reason: "both_miss",
      ok: dadataMiss && nominatimMiss,
    },
    {
      enabled: Boolean(filters.unenriched),
      reason: "unenriched",
      ok: isUnenrichedPlace(place, jobs),
    },
  ];

  const active = checks.filter((row) => row.enabled);
  if (active.length === 0) {
    return null;
  }
  if (!active.every((row) => row.ok)) {
    return null;
  }
  for (const row of active) {
    reasons.push(row.reason);
  }

  return {
    placeId: place.id,
    placeName: place.name,
    regionName,
    trustState: place.trustState ?? "unverified",
    evidenceProviders: place.evidenceProviders ?? [],
    hasCoords,
    jobs,
    reasons,
  };
}

async function loadJobSnapshots(
  dataSource: DataSource,
  placeIds: string[],
): Promise<Map<string, PlaceJobSnapshot[]>> {
  if (placeIds.length === 0) return new Map();
  const rows = (await dataSource.query(
    `SELECT place_id, provider, status, last_error
     FROM place_enrichment_jobs
     WHERE place_id = ANY($1::uuid[])`,
    [placeIds],
  )) as Array<{
    place_id: string;
    provider: PlaceEnrichmentProvider;
    status: string;
    last_error: string | null;
  }>;

  const byPlace = new Map<string, PlaceJobSnapshot[]>();
  for (const row of rows) {
    const list = byPlace.get(row.place_id) ?? [];
    list.push({
      provider: row.provider,
      status: row.status,
      lastError: row.last_error ?? undefined,
    });
    byPlace.set(row.place_id, list);
  }
  return byPlace;
}

/** Удаляет place или deprecate при ссылках из event_locations. */
export async function removeSweepPlace(
  dataSource: DataSource,
  placeId: string,
  hardDelete: boolean,
): Promise<"deleted" | "deprecated"> {
  if (!hardDelete) {
    await deprecateCatalogPlace(dataSource, placeId);
    return "deprecated";
  }

  const refs = (await dataSource.query(
    `SELECT COUNT(*)::int AS c FROM event_locations WHERE place_id = $1`,
    [placeId],
  )) as Array<{ c: number }>;
  if ((refs[0]?.c ?? 0) > 0) {
    await deprecateCatalogPlace(dataSource, placeId);
    return "deprecated";
  }

  await dataSource.query(`DELETE FROM place_aliases WHERE place_id = $1`, [placeId]);
  await dataSource.query(`DELETE FROM place_enrichment_jobs WHERE place_id = $1`, [placeId]);
  await dataSource.query(`DELETE FROM place_status_read_model WHERE place_id = $1`, [placeId]);
  await dataSource.query(`DELETE FROM event_evidence WHERE place_id = $1`, [placeId]);
  await dataSource.query(
    `UPDATE places SET parent_place_id = NULL WHERE parent_place_id = $1`,
    [placeId],
  );
  await dataSource.query(`DELETE FROM places WHERE id = $1`, [placeId]);
  return "deleted";
}

export async function runPlaceCatalogSweep(input: {
  dataSource: DataSource;
  places: PlaceRecord[];
  regionsById: Map<string, { name: string }>;
  filters: PlaceSweepFilters;
  limit?: number;
  apply: boolean;
  hardDelete: boolean;
}): Promise<PlaceSweepSummary> {
  const summary: PlaceSweepSummary = {
    scanned: 0,
    matched: 0,
    pruned: 0,
    deleted: 0,
    deprecated: 0,
    skippedProtected: 0,
    rows: [],
  };

  const slice = input.limit ? input.places.slice(0, input.limit) : input.places;
  const jobsByPlace = await loadJobSnapshots(
    input.dataSource,
    slice.map((place) => place.id),
  );

  for (const place of slice) {
    summary.scanned += 1;
    if (isVendorCatalogPlace(place) || place.kind === "region") {
      summary.skippedProtected += 1;
      continue;
    }

    const region = input.regionsById.get(place.regionId);
    const row = classifyPlaceSweepRow(
      place,
      region?.name ?? "?",
      jobsByPlace.get(place.id) ?? [],
      input.filters,
    );
    if (!row) continue;

    summary.matched += 1;
    summary.rows.push(row);
    if (!input.apply) continue;

    const outcome = await removeSweepPlace(input.dataSource, place.id, input.hardDelete);
    summary.pruned += 1;
    if (outcome === "deleted") {
      summary.deleted += 1;
    } else {
      summary.deprecated += 1;
    }
  }

  return summary;
}

/** Аудит: сколько places попадают под типовые корзины шума. */
export function auditNoiseBuckets(
  places: PlaceRecord[],
  regionsById: Map<string, { name: string }>,
  jobsByPlace: Map<string, PlaceJobSnapshot[]>,
): Record<string, number> {
  const buckets: Record<string, number> = {
    garbage: 0,
    both_miss: 0,
    unenriched: 0,
    only_catalog_no_coords: 0,
  };

  for (const place of places) {
    if (place.kind === "region" || isVendorCatalogPlace(place)) continue;
    const jobs = jobsByPlace.get(place.id) ?? [];
    if (isGarbageIngestPlaceName(place.name)) buckets.garbage += 1;
    const dMiss = isProviderMiss(place, jobs, "dadata");
    const nMiss = isProviderMiss(place, jobs, "nominatim");
    if (dMiss && nMiss) buckets.both_miss += 1;
    if (isUnenrichedPlace(place, jobs)) buckets.unenriched += 1;
    const onlyCatalog =
      (place.evidenceProviders ?? []).length === 1
      && place.evidenceProviders?.[0] === "catalog"
      && place.centroidLat == null;
    if (onlyCatalog) buckets.only_catalog_no_coords += 1;
    void regionsById;
  }

  return buckets;
}

export { enrichmentMissError, GEO_PROVIDERS };
