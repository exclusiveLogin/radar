import { useEffect, useRef } from "react";
import { useObservable } from "../../shared/hooks/useObservable";
import { appLogEntries$ } from "../../shared/state/appLogStore";
import { AppLogList } from "../../shared/components/AppLogList";

/**
 * Лента событий на карте — левый нижний угол, ширина как у левого рейла.
 * host: pointer-events none; rail: auto — иначе hover/scroll не работают.
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
        <AppLogList entries={entries} />
      </div>
    </div>
  );
}
