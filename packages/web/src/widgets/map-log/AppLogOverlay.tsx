import { useEffect, useRef } from "react";
import { useObservable } from "../../shared/hooks/useObservable";
import { appLogEntries$ } from "../../shared/state/appLogStore";

/**
 * Глобальная лента событий/ошибок — правый нижний угол (fixed).
 * host: pointer-events none (карта кликабельна мимо ленты);
 * rail: pointer-events auto — иначе :hover и scroll не работают.
 */
export function AppLogOverlay() {
  const entries = useObservable(appLogEntries$, []);
  const railRef = useRef<HTMLDivElement>(null);

  // passive: false — блокируем zoom карты при прокрутке ленты (wheel не уходит в MapLibre).
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const onWheel = (event: WheelEvent): void => {
      event.stopPropagation();
      if (rail.scrollHeight <= rail.clientHeight) {
        event.preventDefault();
        return;
      }
      const delta = event.deltaY;
      const atTop = rail.scrollTop <= 0;
      const atBottom = rail.scrollTop + rail.clientHeight >= rail.scrollHeight - 1;
      if ((delta < 0 && atTop) || (delta > 0 && atBottom)) {
        event.preventDefault();
      }
    };

    rail.addEventListener("wheel", onWheel, { passive: false });
    return () => rail.removeEventListener("wheel", onWheel);
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <div className="app-log-rail-host" aria-live="polite" aria-label="Системные события">
      <div ref={railRef} className="app-log-rail">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`app-log-rail__item app-log-rail__item--${entry.level}`}
          >
            {entry.source ? `${entry.source}: ${entry.message}` : entry.message}
          </div>
        ))}
      </div>
    </div>
  );
}