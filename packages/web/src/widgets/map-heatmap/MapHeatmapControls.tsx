import { Button } from "../../shared/ds";
import { useObservable } from "../../shared/hooks/useObservable";
import type { EventHeatmapPeriod } from "@radar/shared";
import {
  heatmapLoading$,
  heatmapMeta$,
  heatmapPeriod$,
  setHeatmapPeriod,
} from "../../shared/state/heatmapStore";

const PERIOD_OPTIONS: Array<{ id: EventHeatmapPeriod; label: string }> = [
  { id: "24h", label: "24ч" },
  { id: "7d", label: "7д" },
  { id: "30d", label: "1мес" },
  { id: "all", label: "всё" },
];

/** Панель настроек теплокарты (период + статус) — без toggle слоя. */
export function MapHeatmapControls() {
  const period = useObservable(heatmapPeriod$, "24h");
  const meta = useObservable(heatmapMeta$, null);
  const loading = useObservable(heatmapLoading$, false);

  return (
    <div className="map-layers__subpanel map-layers__subpanel--heatmap">
      <div className="map-layers__periods" role="group" aria-label="Период теплокарты">
        {PERIOD_OPTIONS.map((option) => (
          <Button
            key={option.id}
            variant={period === option.id ? "primary" : "ghost"}
            disabled={loading}
            title={`События за ${option.label}`}
            onClick={() => setHeatmapPeriod(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {loading && <span className="map-layers__hint">загрузка…</span>}
      {!loading && meta && (
        <span className="map-layers__hint">{meta.count} точек</span>
      )}
    </div>
  );
}
