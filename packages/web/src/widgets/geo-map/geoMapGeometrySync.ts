import { mapApi } from "../../shared/api/mapApi";
import { pushAppLog } from "../../shared/state/appLogStore";
import {
  activeDistrictGeoFeatureIds,
  visibleRegionCodes,
} from "../../shared/state/derivations";
import {
  buildDistrictsCollection,
  buildRegionsCollection,
  bumpGeoFetchGeneration,
  currentGeoFetchGeneration,
  dropDistrictFeature,
  dropRegionFeature,
  finishDistrictLoad,
  finishRegionsLoad,
  getDistrictFeature,
  hasRegionFeature,
  markDistrictError,
  markDistrictLoading,
  markRegionsLoading,
  mergeDistrictFeatures,
  mergeRegionFeatures,
} from "../../shared/state/geoGeometryStore";
import { mapViewAnchor$, placesById$, regionsByCode$ } from "../../shared/state/mapStore";
import type {
  DistrictsFetchData,
  RegionsGeometryFetchData,
} from "./geoMapEffectTypes";
import type { PolygonFeature } from "./geoMapTypes";

const DISTRICT_FETCH_CONCURRENCY = 4;

function collectVisibleRegionCodes(): Set<string> {
  return new Set(
    visibleRegionCodes(regionsByCode$.value, mapViewAnchor$.value),
  );
}

function collectActiveDistrictIds(): Set<string> {
  return new Set(activeDistrictGeoFeatureIds(placesById$.value));
}

function pruneRegionCache(visibleCodes: Set<string>): void {
  for (const code of [
    ...buildRegionsCollection().features.map((f) =>
      String(f.properties.regionCode ?? f.id ?? ""),
    ),
  ]) {
    if (code && !visibleCodes.has(code)) dropRegionFeature(code);
  }
}

function pruneDistrictCache(activeIds: Set<string>): void {
  for (const id of [
    ...buildDistrictsCollection().features.map((f) =>
      String(f.id ?? f.properties.geoFeatureId ?? ""),
    ),
  ]) {
    if (id && !activeIds.has(id)) dropDistrictFeature(id);
  }
}

async function fetchMissingRegionCodes(codes: string[], generation: number): Promise<void> {
  const pending = markRegionsLoading(codes.filter((code) => !hasRegionFeature(code)));
  if (pending.length === 0) return;
  try {
    const layer = await mapApi.regionsGeoJson({ regionCodes: pending });
    if (generation !== currentGeoFetchGeneration()) return;
    mergeRegionFeatures(layer.features as PolygonFeature[]);
  } finally {
    finishRegionsLoad(pending);
  }
}

async function fetchDistrictBatch(ids: string[], generation: number): Promise<void> {
  const pending = ids.filter((id) => !getDistrictFeature(id) && markDistrictLoading(id));
  if (pending.length === 0) return;

  for (let i = 0; i < pending.length; i += DISTRICT_FETCH_CONCURRENCY) {
    if (generation !== currentGeoFetchGeneration()) return;
    const batch = pending.slice(i, i + DISTRICT_FETCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const layer = await mapApi.districtsGeoJson({ geoFeatureIds: [id] });
          if (generation !== currentGeoFetchGeneration()) return;
          mergeDistrictFeatures(layer.features as PolygonFeature[]);
        } catch {
          markDistrictError(id);
        } finally {
          finishDistrictLoad(id);
        }
      }),
    );
  }
}

/** Lazy fetch контуров субъектов по visible region codes. */
export async function syncVisibleRegionGeometry(): Promise<RegionsGeometryFetchData> {
  const generation = currentGeoFetchGeneration();
  const visible = collectVisibleRegionCodes();
  const missing = [...visible].filter((code) => !hasRegionFeature(code));

  if (missing.length > 0) {
    pushAppLog("info", `Контуры: запрос ${missing.length} регионов`, { source: "Регионы" });
    await fetchMissingRegionCodes(missing, generation);
  }

  if (generation === currentGeoFetchGeneration()) {
    pruneRegionCache(visible);
  }

  const collection = buildRegionsCollection();
  pushAppLog("info", `Контуры: ${collection.features.length} в кеше`, { source: "Регионы" });
  return collection;
}

/** Lazy fetch полигонов районов по geoFeatureId из places-state. */
export async function syncDistrictGeometry(): Promise<DistrictsFetchData> {
  const generation = currentGeoFetchGeneration();
  const activeIds = collectActiveDistrictIds();
  const pending = [...activeIds].filter((id) => !getDistrictFeature(id));

  if (pending.length > 0) {
    pushAppLog("info", `Районы: запрос ${pending.length} полигонов`, { source: "Районы" });
    await fetchDistrictBatch([...activeIds], generation);
  }

  if (generation === currentGeoFetchGeneration()) {
    pruneDistrictCache(activeIds);
  }

  const collection = buildDistrictsCollection();
  pushAppLog("info", `Районы: ${collection.features.length} в кеше`, { source: "Районы" });
  return collection;
}

/** Отмена in-flight fetch при смене fold-state (live ↔ replay). */
export function cancelStaleGeoFetches(): void {
  bumpGeoFetchGeneration();
}
