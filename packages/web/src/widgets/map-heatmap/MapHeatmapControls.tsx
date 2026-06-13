import { Button } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import type { EventHeatmapPeriod } from "@radar/shared";
import {
  EVENT_HEATMAP_FILTER_TYPES,
  EVENT_HEATMAP_TYPE_LABELS,
} from "@radar/shared";
import {
  GEO_MAP_LAYER_FETCH_IDLE,
  heatmapFetchStatus$,
} from "../../shared/state/geoMapLayerFetchStore";
import {
  hasActiveHeatmapEventTypesFilter,
  HEATMAP_EVENT_TYPES_FILTER_ALL,
  heatmapEventTypesFilter$,
  heatmapMeta$,
  heatmapPeriod$,
  isHeatmapEventTypesAllEnabled,
  setHeatmapPeriod,
  toggleHeatmapEventType,
  toggleHeatmapEventTypesAll,
} from "../../shared/state/heatmapStore";

const PERIOD_OPTIONS: Array<{ id: EventHeatmapPeriod; label: string }> = [
  { id: "24h", label: "24ч" },
  { id: "7d", label: "7д" },
  { id: "30d", label: "1мес" },
  { id: "all", label: "всё" },
];

/** Панель настроек теплокарты: период, фильтр типов, статус загрузки. */
export function MapHeatmapControls() {
  const period = useObservable(heatmapPeriod$, "24h");
  const eventTypesFilter = useObservable(
    heatmapEventTypesFilter$,
    HEATMAP_EVENT_TYPES_FILTER_ALL,
  );
  const meta = useObservable(heatmapMeta$, null);
  const fetchStatus = useObservable(heatmapFetchStatus$, GEO_MAP_LAYER_FETCH_IDLE);
  const loading = fetchStatus.loading;
  const allTypesEnabled = isHeatmapEventTypesAllEnabled(eventTypesFilter);
  const hasActiveFilter = hasActiveHeatmapEventTypesFilter(eventTypesFilter);
  const customTypes =
    eventTypesFilter.mode === "custom" ? eventTypesFilter.types : new Set();

  return (
    <div className="map-layers__subpanel map-layers__subpanel--heatmap">
      <div className="map-layers__periods" role="group" aria-label="Период теплокарты">
        {PERIOD_OPTIONS.map((option) => (
          <Button
            key={option.id}
            variant={period === option.id ? "primary" : "ghost"}
            disabled={loading || !hasActiveFilter}
            title={`События за ${option.label}`}
            onClick={() => setHeatmapPeriod(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="map-layers__event-types" role="group" aria-label="Типы событий теплокарты">
        <Button
          variant={allTypesEnabled ? "primary" : "ghost"}
          disabled={loading}
          aria-pressed={allTypesEnabled}
          title="Все типы событий"
          onClick={() => toggleHeatmapEventTypesAll()}
        >
          все
        </Button>
        {EVENT_HEATMAP_FILTER_TYPES.map((type) => {
          const label = EVENT_HEATMAP_TYPE_LABELS[type];
          const enabled = !allTypesEnabled && customTypes.has(type);
          return (
            <Button
              key={type}
              variant={enabled ? "primary" : "ghost"}
              disabled={loading}
              aria-pressed={enabled}
              title={label.title}
              onClick={() => toggleHeatmapEventType(type)}
            >
              {label.short}
            </Button>
          );
        })}
      </div>

      {loading && <span className="map-layers__hint">загрузка…</span>}
      {!loading && !hasActiveFilter && (
        <span className="map-layers__hint">выберите тип события</span>
      )}
      {!loading && hasActiveFilter && meta && (
        <span className="map-layers__hint">{meta.count} точек</span>
      )}
    </div>
  );
}
