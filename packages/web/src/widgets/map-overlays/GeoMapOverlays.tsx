import { GeoMapStatsOverlay } from "../map-stats/GeoMapStatsOverlay";

/** HUD-оверлеи поверх canvas карты (статистика контуров). Лента логов — в AppShell. */
export function GeoMapOverlays() {
  return <GeoMapStatsOverlay />;
}
