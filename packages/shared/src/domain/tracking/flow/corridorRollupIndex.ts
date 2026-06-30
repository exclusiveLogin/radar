/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/flow
 * purpose: In-memory индекс проходов по P2P-коридору для эмпирического тока B.
 *          Накапливает count на рёбрах; bearing берётся из геометрии сегмента.
 * ---
 */
import { bearingDeg } from "../flowAlignment";
import { buildSegmentKey } from "./segmentKey";
import type { ThreatProfile } from "../types";

/** Запись коридора: число проходов + координаты направления. */
export type CorridorRollupEntry = {
  count: number;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
};

/** Накопительный индекс коридоров (L2 rollup in-memory). */
export type CorridorRollupIndex = {
  lookup: (
    fromPlaceKey: string,
    toPlaceKey: string,
    threatProfile?: ThreatProfile,
  ) => CorridorRollupEntry | null;
  recordPass: (
    fromPlaceKey: string,
    toPlaceKey: string,
    fromLat: number,
    fromLon: number,
    toLat: number,
    toLon: number,
    threatProfile?: ThreatProfile,
  ) => void;
};

/** Пустой индекс — только lookup (всегда null). */
export const EMPTY_CORRIDOR_ROLLUP_INDEX: CorridorRollupIndex = {
  lookup: () => null,
  recordPass: () => {},
};

/** Создаёт мутабельный индекс для накопления проходов в ходе rebuild. */
export function createCorridorRollupIndex(): CorridorRollupIndex {
  const map = new Map<string, CorridorRollupEntry>();

  return {
    lookup(fromPlaceKey, toPlaceKey, threatProfile) {
      const key = buildSegmentKey(fromPlaceKey, toPlaceKey, threatProfile);
      return map.get(key) ?? null;
    },
    recordPass(fromPlaceKey, toPlaceKey, fromLat, fromLon, toLat, toLon, threatProfile) {
      const key = buildSegmentKey(fromPlaceKey, toPlaceKey, threatProfile);
      const prev = map.get(key);
      if (prev) {
        prev.count += 1;
        return;
      }
      map.set(key, { count: 1, fromLat, fromLon, toLat, toLon });
    },
  };
}

/** Азимут коридора B (from → to). */
export function corridorBearingDeg(entry: CorridorRollupEntry): number {
  return bearingDeg(entry.fromLat, entry.fromLon, entry.toLat, entry.toLon);
}
