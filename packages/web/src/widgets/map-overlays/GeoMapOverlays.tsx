import { GeoMapStatsOverlay } from "../map-stats/GeoMapStatsOverlay";

/** HUD-оверлеи поверх canvas карты (статистика контуров). Лента логов — глобально в App.tsx. */
export function GeoMapOverlays() {
  return <GeoMapStatsOverlay />;
}
