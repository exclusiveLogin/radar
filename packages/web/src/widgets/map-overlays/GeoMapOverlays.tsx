import { GeoMapLogOverlay } from "../map-log/GeoMapLogOverlay";
import { GeoMapStatsOverlay } from "../map-stats/GeoMapStatsOverlay";

/** Все HUD-оверлеи поверх карты — композиция в AppShell (как timeline / layers). */
export function GeoMapOverlays() {
  return (
    <>
      <GeoMapStatsOverlay />
      <GeoMapLogOverlay />
    </>
  );
}
