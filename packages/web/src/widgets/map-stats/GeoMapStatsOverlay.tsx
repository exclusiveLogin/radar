import { useObservable } from "../../shared/hooks/useObservable";
import {
  GEO_MAP_LAYER_FETCH_IDLE,
  regionsFetchStatus$,
} from "../../shared/state/geoMapLayerFetchStore";
import { geoMapStats$ } from "../../shared/state/geoMapStatsStore";

/** Счётчики контуров/мест и ошибка геометрии — оверлей поверх карты (как timeline/layers в AppShell). */
export function GeoMapStatsOverlay() {
  const stats = useObservable(geoMapStats$, geoMapStats$.value);
  const regionsStatus = useObservable(regionsFetchStatus$, GEO_MAP_LAYER_FETCH_IDLE);
  const regionsError = regionsStatus.error;

  if (regionsError) {
    return (
      <div className="geo-map-panel__stats">Геометрия: {regionsError}</div>
    );
  }

  if (stats.regionOutlines > 0 || stats.placeCount > 0) {
    return (
      <div className="geo-map-panel__stats">
        Контуров: {stats.regionOutlines} · мест: {stats.placeCount}
      </div>
    );
  }

  return (
    <div className="geo-map-panel__stats">Нет активных регионов/мест</div>
  );
}
