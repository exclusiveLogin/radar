import { BehaviorSubject } from "rxjs";
import type { GeoJsonCollection, PolygonFeature } from "../../widgets/geo-map/geoMapTypes";

type DistrictEntry =
  | { status: "loading" }
  | { status: "ready"; feature: PolygonFeature }
  | { status: "error" };

/** SSOT кеша geo-слоёв (независимо от fold state). */
const regionFeatures = new Map<string, PolygonFeature>();
const districtFeatures = new Map<string, DistrictEntry>();
const inFlightRegions = new Set<string>();
const inFlightDistricts = new Set<string>();

/** Поколение fetch: stale HTTP-ответы игнорируются после bump. */
let geoFetchGeneration = 0;

export function currentGeoFetchGeneration(): number {
  return geoFetchGeneration;
}

export function bumpGeoFetchGeneration(): number {
  geoFetchGeneration += 1;
  bumpGeoGeometryRevision();
  return geoFetchGeneration;
}

/** Тик для combineLatest перерисовки карты при изменении geo-кеша. */
export const geoGeometryRevision$ = new BehaviorSubject(0);

function bumpGeoGeometryRevision(): void {
  geoGeometryRevision$.next(geoGeometryRevision$.value + 1);
}

export function getRegionFeature(regionCode: string): PolygonFeature | undefined {
  return regionFeatures.get(regionCode);
}

export function hasRegionFeature(regionCode: string): boolean {
  return regionFeatures.has(regionCode);
}

export function mergeRegionFeatures(features: PolygonFeature[]): void {
  if (features.length === 0) return;
  for (const feature of features) {
    const code = String(feature.properties.regionCode ?? feature.id ?? "");
    if (!code) continue;
    regionFeatures.set(code, feature);
  }
  bumpGeoGeometryRevision();
}

export function dropRegionFeature(regionCode: string): void {
  if (!regionFeatures.delete(regionCode)) return;
  bumpGeoGeometryRevision();
}

export function buildRegionsCollection(): GeoJsonCollection {
  return {
    type: "FeatureCollection",
    features: [...regionFeatures.values()],
  };
}

export function getDistrictFeature(geoFeatureId: string): PolygonFeature | undefined {
  const entry = districtFeatures.get(geoFeatureId);
  return entry?.status === "ready" ? entry.feature : undefined;
}

export function mergeDistrictFeatures(features: PolygonFeature[]): void {
  if (features.length === 0) return;
  for (const feature of features) {
    const id = String(feature.id ?? feature.properties.geoFeatureId ?? "");
    if (!id) continue;
    districtFeatures.set(id, { status: "ready", feature });
  }
  bumpGeoGeometryRevision();
}

export function dropDistrictFeature(geoFeatureId: string): void {
  if (!districtFeatures.delete(geoFeatureId)) return;
  bumpGeoGeometryRevision();
}

export function buildDistrictsCollection(): GeoJsonCollection {
  const features: PolygonFeature[] = [];
  for (const entry of districtFeatures.values()) {
    if (entry.status === "ready") features.push(entry.feature);
  }
  return { type: "FeatureCollection", features };
}

export function markDistrictLoading(geoFeatureId: string): boolean {
  if (districtFeatures.has(geoFeatureId) || inFlightDistricts.has(geoFeatureId)) {
    return false;
  }
  inFlightDistricts.add(geoFeatureId);
  districtFeatures.set(geoFeatureId, { status: "loading" });
  return true;
}

export function markDistrictError(geoFeatureId: string): void {
  inFlightDistricts.delete(geoFeatureId);
  districtFeatures.set(geoFeatureId, { status: "error" });
  bumpGeoGeometryRevision();
}

export function finishDistrictLoad(geoFeatureId: string): void {
  inFlightDistricts.delete(geoFeatureId);
}

export function markRegionsLoading(codes: string[]): string[] {
  const pending: string[] = [];
  for (const code of codes) {
    if (regionFeatures.has(code) || inFlightRegions.has(code)) continue;
    inFlightRegions.add(code);
    pending.push(code);
  }
  return pending;
}

export function finishRegionsLoad(codes: string[]): void {
  for (const code of codes) {
    inFlightRegions.delete(code);
  }
}

/** Сброс lazy geo-кеша (переключение live ↔ replay). */
export function clearAllGeoGeometry(): void {
  regionFeatures.clear();
  districtFeatures.clear();
  inFlightRegions.clear();
  inFlightDistricts.clear();
  bumpGeoFetchGeneration();
}
