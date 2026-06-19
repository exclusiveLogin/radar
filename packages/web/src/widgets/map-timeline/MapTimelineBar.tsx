import { useCallback, useEffect, useMemo, useState } from "react";
import { Subject, interval, merge } from "rxjs";
import { debounceTime } from "rxjs/operators";
import { Button } from "../../shared/ds";
import { formatDateTime } from "../../shared/format/dateTime";
import { useObservable } from "../../shared/hooks/useObservable";
import {
  clearHistoricalView,
  historicalAsOf$,
  isHistoricalMapView,
  mapHistoricalLoading$,
  setHistoricalAsOf,
} from "../../shared/state/mapStore";

/** Окно fold на карте (совпадает с DEFAULT_MAP_STATE_TTL_MS на API). */
const MAP_TTL_MS = 24 * 60 * 60 * 1000;

const SLIDER_STEPS = 1000;
const SCRUB_DEBOUNCE_MS = 350;

/** ISO из позиции ползунка: 0 — начало окна TTL, max — live (now). */
function isoFromSliderStep(step: number, windowStartMs: number, windowEndMs: number): string {
  const ratio = step / SLIDER_STEPS;
  const ms = windowStartMs + ratio * (windowEndMs - windowStartMs);
  return new Date(ms).toISOString();
}

/** Позиция ползунка из ISO маркера asOf. */
function sliderStepFromIso(iso: string, windowStartMs: number, windowEndMs: number): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return SLIDER_STEPS;
  const span = windowEndMs - windowStartMs;
  if (span <= 0) return SLIDER_STEPS;
  const ratio = (ms - windowStartMs) / span;
  return Math.min(SLIDER_STEPS, Math.max(0, Math.round(ratio * SLIDER_STEPS)));
}

/**
 * Ползунок таймлайна карты: scrub по окну TTL, live на правом краю.
 * Рендерится поверх карты в AppShell.
 */
export function MapTimelineBar() {
  const historicalAsOf = useObservable(historicalAsOf$, null);
  const loading = useObservable(mapHistoricalLoading$, false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sliderStep, setSliderStep] = useState(SLIDER_STEPS);
  const { scrub$, flush$ } = useMemo(
    () => ({ scrub$: new Subject<number>(), flush$: new Subject<number>() }),
    [],
  );

  const windowEndMs = nowMs;
  const windowStartMs = windowEndMs - MAP_TTL_MS;

  const markerIso = useMemo(() => {
    if (!isHistoricalMapView()) {
      return new Date(windowEndMs).toISOString();
    }
    return historicalAsOf ?? new Date(windowEndMs).toISOString();
  }, [historicalAsOf, windowEndMs]);

  // Тик «now» только в live mode — в replay маркер не уплывает.
  useEffect(() => {
    if (historicalAsOf !== null) return;
    const sub = interval(1000).subscribe(() => setNowMs(Date.now()));
    return () => sub.unsubscribe();
  }, [historicalAsOf]);

  // Синхронизация ползунка с store (клик из ленты событий и т.п.).
  useEffect(() => {
    if (historicalAsOf === null) {
      setSliderStep(SLIDER_STEPS);
      return;
    }
    setSliderStep(sliderStepFromIso(historicalAsOf, windowStartMs, windowEndMs));
  }, [historicalAsOf, windowStartMs, windowEndMs]);

  const applyStep = useCallback(
    (step: number) => {
      if (step >= SLIDER_STEPS) {
        clearHistoricalView();
        return;
      }

      const iso = isoFromSliderStep(step, windowStartMs, windowEndMs);
      if (iso === historicalAsOf$.value) return;
      setHistoricalAsOf(iso);
    },
    [windowStartMs, windowEndMs],
  );

  useEffect(() => {
    const sub = merge(scrub$.pipe(debounceTime(SCRUB_DEBOUNCE_MS)), flush$).subscribe((step) =>
      void applyStep(step),
    );
    return () => sub.unsubscribe();
  }, [applyStep, flush$, scrub$]);

  const onSliderInput = (step: number): void => {
    setSliderStep(step);
    scrub$.next(step);
  };

  const modeLabel = historicalAsOf !== null ? "REPLAY" : "LIVE";

  return (
    <div className="map-timeline" aria-label="Таймлайн карты">
      <div className="map-timeline__header">
        <span className={`map-timeline__mode map-timeline__mode--${modeLabel.toLowerCase()}`}>
          {modeLabel}
        </span>
        <span className="map-timeline__marker" title={markerIso}>
          {formatDateTime(markerIso)}
        </span>
        {loading && <span className="map-timeline__loading">загрузка…</span>}
      </div>

      <div className="map-timeline__track">
        <span className="map-timeline__edge">−24ч</span>
        <input
          type="range"
          className="map-timeline__slider"
          min={0}
          max={SLIDER_STEPS}
          step={1}
          value={sliderStep}
          disabled={loading}
          aria-valuetext={formatDateTime(markerIso)}
          onChange={(event) => onSliderInput(Number(event.target.value))}
          onMouseUp={(event) => flush$.next(Number((event.target as HTMLInputElement).value))}
          onTouchEnd={(event) => flush$.next(Number((event.target as HTMLInputElement).value))}
        />
        <span className="map-timeline__edge">сейчас</span>
      </div>

      {historicalAsOf !== null && (
        <Button
          variant="primary"
          disabled={loading}
          title="Вернуться к live-карте"
          onClick={() => void clearHistoricalView()}
        >
          Live
        </Button>
      )}
    </div>
  );
}
