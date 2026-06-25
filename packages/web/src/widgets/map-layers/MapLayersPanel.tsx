import { useObservable } from "../../shared/hooks/useObservable";
import { formatDateTime } from "../../shared/format/dateTime";
import {
  geoMapFetchStatuses$,
  GEO_MAP_LAYER_FETCH_IDLE,
  resolveGeoMapLayerFetchStatus,
} from "../../shared/state/geoMapLayerFetchStore";
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
  loading,
  error,
}: {
  id: GeoMapLayerId;
  enabled: boolean;
  loading: boolean;
  error: string | null;
}) {
  return (
    <button
      type="button"
      className={`map-layers__row ${enabled ? "is-on" : ""}`}
      aria-pressed={enabled}
      onClick={() => toggleGeoMapLayer(id)}
    >
      <span className="map-layers__label">{GEO_MAP_LAYER_LABELS[id]}</span>
      <span className="map-layers__status" aria-hidden>
        {loading && <span className="map-layers__status-dot map-layers__status-dot--loading" />}
        {!loading && error && (
          <span className="map-layers__status-dot map-layers__status-dot--error" title={error}>
            !
          </span>
        )}
      </span>
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
export function MapLayersPanel({ onClose }: { onClose?: () => void }) {
  const layers = useObservable(geoMapLayers$, geoMapLayers$.value);
  const fetchStatuses = useObservable(geoMapFetchStatuses$, {
    regions: GEO_MAP_LAYER_FETCH_IDLE,
    districts: GEO_MAP_LAYER_FETCH_IDLE,
    heatmap: GEO_MAP_LAYER_FETCH_IDLE,
  });

  return (
    <aside
      id="map-layers-panel"
      className="map-layers-panel"
      aria-label="Слои карты"
    >
      <header className="map-layers-panel__head">
        <span className="map-layers-panel__title">Слои</span>
        {onClose ? (
          <button
            type="button"
            className="map-layers-panel__close"
            onClick={onClose}
            aria-label="Закрыть панель слоёв"
          >
            ×
          </button>
        ) : null}
      </header>
      <div className="map-layers-panel__list">
        {GEO_MAP_LAYER_ORDER.map((id) => {
          const enabled = layers[id];
          const status = resolveGeoMapLayerFetchStatus(id, fetchStatuses);
          return (
            <div key={id} className="map-layers-panel__item">
              <LayerSwitch
                id={id}
                enabled={enabled}
                loading={status.loading}
                error={status.error}
              />
              {enabled && id === "heatmap" && <MapHeatmapControls />}
              {enabled && id === "timeline" && <TimelineLayerHint />}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
