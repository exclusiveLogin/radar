/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/flow
 * purpose: Накопительная гравитация мест — историческая масса winner-облаков.
 *          Зеркало corridorRollupIndex, но для узлов (зон), а не рёбер.
 * ---
 */
import { zoneKeyForCandidate } from "./geohashZoneKey";
import type { TrackingCandidate } from "../types";

export type PlaceGravityEntry = {
  mass: number;
  lat: number;
  lon: number;
  zoneKey: string;
};

export type PlaceGravityIndex = {
  lookup: (zoneKey: string) => PlaceGravityEntry | null;
  lookupForCandidate: (candidate: TrackingCandidate, geohashPrecision: number) => PlaceGravityEntry | null;
  recordCluster: (zoneKey: string, mass: number, lat: number, lon: number) => void;
  /** Все зоны с массой > 0 (для heatmap API). */
  entries: () => PlaceGravityEntry[];
};

export const EMPTY_PLACE_GRAVITY_INDEX: PlaceGravityIndex = {
  lookup: () => null,
  lookupForCandidate: () => null,
  recordCluster: () => {},
  entries: () => [],
};

/** Создаёт мутабельный индекс гравитации мест. */
export function createPlaceGravityIndex(): PlaceGravityIndex {
  const map = new Map<string, PlaceGravityEntry>();

  return {
    lookup(zoneKey) {
      return map.get(zoneKey) ?? null;
    },
    lookupForCandidate(candidate, geohashPrecision) {
      const key = zoneKeyForCandidate(
        candidate.placeId,
        candidate.lat,
        candidate.lon,
        geohashPrecision,
      );
      return map.get(key) ?? null;
    },
    recordCluster(zoneKey, mass, lat, lon) {
      if (mass <= 0) return;
      const prev = map.get(zoneKey);
      if (prev) {
        prev.mass += mass;
        return;
      }
      map.set(zoneKey, { mass, lat, lon, zoneKey });
    },
    entries() {
      return [...map.values()];
    },
  };
}
