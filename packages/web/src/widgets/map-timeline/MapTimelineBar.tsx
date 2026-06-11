import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../shared/ds";
import { formatDateTime } from "../../shared/format/dateTime";
import { useObservable } from "../../shared/hooks/useObservable";
import {
  clearHistoricalView,
  historicalAsOf$,
  isHistoricalMapView,
  setHistoricalAsOf,
} from "../../shared/state/mapStore";

/** Окно fold на карте (совпадает с DEFAULT_MAP_STATE_TTL_MS на API). */
const MAP_TTL_MS = 24 * 60 * 60 * 1000;

const SLIDER_STEPS = 1000;

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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sliderStep, setSliderStep] = useState(SLIDER_STEPS);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);

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
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
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
    async (step: number) => {
      if (step >= SLIDER_STEPS) {
        setLoading(true);
        try {
          await clearHistoricalView();
        } finally {
          setLoading(false);
        }
        return;
      }

      const iso = isoFromSliderStep(step, windowStartMs, windowEndMs);
      if (iso === historicalAsOf$.value) return;

      setLoading(true);
      pendingRef.current = iso;
      try {
        await setHistoricalAsOf(iso);
      } finally {
        if (pendingRef.current === iso) {
          pendingRef.current = null;
          setLoading(false);
        }
      }
    },
    [windowStartMs, windowEndMs],
  );

  const onSliderInput = (step: number): void => {
    setSliderStep(step);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void applyStep(step);
    }, 350);
  };

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

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
          onMouseUp={(event) => {
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
            }
            void applyStep(Number((event.target as HTMLInputElement).value));
          }}
          onTouchEnd={(event) => {
            if (debounceRef.current) {
              clearTimeout(debounceRef.current);
              debounceRef.current = null;
            }
            void applyStep(Number((event.target as HTMLInputElement).value));
          }}
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
