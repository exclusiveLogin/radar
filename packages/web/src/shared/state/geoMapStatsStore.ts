import { BehaviorSubject } from "rxjs";

export type GeoMapStats = {
  regionOutlines: number;
  placeCount: number;
};

export const geoMapStats$ = new BehaviorSubject<GeoMapStats>({
  regionOutlines: 0,
  placeCount: 0,
});

export function setGeoMapStats(patch: Partial<GeoMapStats>): void {
  geoMapStats$.next({ ...geoMapStats$.value, ...patch });
}

export function resetGeoMapStats(): void {
  geoMapStats$.next({ regionOutlines: 0, placeCount: 0 });
}
