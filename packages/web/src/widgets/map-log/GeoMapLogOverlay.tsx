import { useObservable } from "../../shared/hooks/useObservable";
import { geoMapLogEntries$ } from "../../shared/state/geoMapLogStore";

/** Игровая лента логов — правый нижний угол карты (монтируется из AppShell). */
export function GeoMapLogOverlay() {
  const entries = useObservable(geoMapLogEntries$, []);

  if (entries.length === 0) return null;

  return (
    <div className="geo-map-log-rail" aria-live="polite" aria-label="События карты">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`geo-map-log-rail__item geo-map-log-rail__item--${entry.level}`}
        >
          {entry.message}
        </div>
      ))}
    </div>
  );
}
