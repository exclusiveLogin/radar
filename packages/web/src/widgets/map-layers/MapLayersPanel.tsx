import { useObservable } from "../../shared/hooks/useObservable";
import { formatDateTime } from "../../shared/format/dateTime";
import {
  GEO_MAP_LAYER_LABELS,
  GEO_MAP_LAYER_ORDER,
  geoMapLayers$,
  toggleGeoMapLayer,
  type GeoMapLayerId,
} from "../../shared/state/mapLayerStore";
import { historicalAsOf$ } from "../../shared/state/mapStore";
import { MapHeatmapControls } from "../map-heatmap/MapHeatmapControls";

function LayerSwitch({
  id,
  enabled,
}: {
  id: GeoMapLayerId;
  enabled: boolean;
}) {
  return (
    <button
      type="button"
      className={`map-layers__row ${enabled ? "is-on" : ""}`}
      aria-pressed={enabled}
      onClick={() => toggleGeoMapLayer(id)}
    >
      <span className="map-layers__label">{GEO_MAP_LAYER_LABELS[id]}</span>
      <span className="map-layers__track" aria-hidden>
        <span className="map-layers__thumb" />
      </span>
    </button>
  );
}

function TimelineLayerHint() {
  const historicalAsOf = useObservable(historicalAsOf$, null);
  return (
    <div className="map-layers__subpanel map-layers__subpanel--timeline">
      <span className="map-layers__hint">
        {historicalAsOf !== null ? "REPLAY" : "LIVE"}
        {" · "}
        {historicalAsOf !== null
          ? formatDateTime(historicalAsOf)
          : "ползунок внизу"}
      </span>
    </div>
  );
}

/**
 * Боковая панель слоёв: toggle каждого слоя + вложенная панель настроек при включении.
 */
export function MapLayersPanel() {
  const layers = useObservable(geoMapLayers$, geoMapLayers$.value);

  return (
    <aside className="map-layers-panel" aria-label="Слои карты">
      <header className="map-layers-panel__title">Слои</header>
      <div className="map-layers-panel__list">
        {GEO_MAP_LAYER_ORDER.map((id) => {
          const enabled = layers[id];
          return (
            <div key={id} className="map-layers-panel__item">
              <LayerSwitch id={id} enabled={enabled} />
              {enabled && id === "heatmap" && <MapHeatmapControls />}
              {enabled && id === "timeline" && <TimelineLayerHint />}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
