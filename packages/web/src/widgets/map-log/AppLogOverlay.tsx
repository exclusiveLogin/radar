import { useObservable } from "../../shared/hooks/useObservable";
import { appLogEntries$ } from "../../shared/state/appLogStore";

/** Глобальная лента событий/ошибок — правый нижний угол (fixed). */
export function AppLogOverlay() {
  const entries = useObservable(appLogEntries$, []);

  if (entries.length === 0) return null;

  return (
    <div className="app-log-rail" aria-live="polite" aria-label="Системные события">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`app-log-rail__item app-log-rail__item--${entry.level}`}
        >
          {entry.source ? `${entry.source}: ${entry.message}` : entry.message}
        </div>
      ))}
    </div>
  );
}
