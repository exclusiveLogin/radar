import { useCallback, useEffect, useMemo, useState } from "react";
import { Subject, interval, merge } from "rxjs";
import { debounceTime } from "rxjs/operators";
import { Button } from "../../shared/ds";
import { formatDateTime } from "../../shared/format/dateTime";
import { useObservable } from "../../shared/hooks/useObservable";
import {
  historicalAsOf$,
  isHistoricalMapView,
  mapHistoricalLoading$,
  setHistoricalAsOf,
} from "../../shared/state/mapStore";
import {
  isoFromSliderStep,
  isTimelineLiveButtonVisible,
  resolveTimelineWindowEnd,
  resolveTimelineWindowStart,
  returnTimelineToLive,
  setTimelineScale,
  sliderStepFromIso,
  timelineAnchorEnd$,
  timelineScale$,
  TIMELINE_SLIDER_STEPS,
  type TimelineScale,
} from "../../shared/state/timelineStore";
import { TimelineCalendarButton } from "./TimelineCalendarButton";
import { TimelineTrack } from "./TimelineTrack";

const SCRUB_DEBOUNCE_MS = 350;

const SCALE_OPTIONS: Array<{ id: TimelineScale; label: string }> = [
  { id: "24h", label: "24ч" },
  { id: "7d", label: "7д" },
  { id: "30d", label: "30д" },
];

function formatEdgeLabel(isoMs: number): string {
  return new Date(isoMs).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  });
}

/**
 * Ползунок таймлайна карты: масштаб 24ч/7д/30д, календарь, scrub по окну.
 * Рендерится поверх карты в AppShell.
 */
export function MapTimelineBar() {
  const historicalAsOf = useObservable(historicalAsOf$, null);
  const scale = useObservable(timelineScale$, "24h");
  const anchorEnd = useObservable(timelineAnchorEnd$, null);
  const loading = useObservable(mapHistoricalLoading$, false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sliderStep, setSliderStep] = useState(TIMELINE_SLIDER_STEPS);
  const { scrub$, flush$ } = useMemo(
    () => ({ scrub$: new Subject<number>(), flush$: new Subject<number>() }),
    [],
  );

  const windowEndMs = resolveTimelineWindowEnd(nowMs);
  const windowStartMs = resolveTimelineWindowStart(windowEndMs, scale);
  const isLiveRightEdge = anchorEnd === null;

  const markerIso = useMemo(() => {
    if (!isHistoricalMapView()) {
      return new Date(windowEndMs).toISOString();
    }
    return historicalAsOf ?? new Date(windowEndMs).toISOString();
  }, [historicalAsOf, windowEndMs]);

  // Тик «now» только когда правая граница = сейчас и не replay.
  useEffect(() => {
    if (historicalAsOf !== null || anchorEnd !== null) return;
    const sub = interval(1000).subscribe(() => setNowMs(Date.now()));
    return () => sub.unsubscribe();
  }, [historicalAsOf, anchorEnd]);

  // Синхронизация ползунка с store (клик из ленты событий и т.п.).
  useEffect(() => {
    if (historicalAsOf === null) {
      setSliderStep(TIMELINE_SLIDER_STEPS);
      return;
    }
    setSliderStep(sliderStepFromIso(historicalAsOf, windowStartMs, windowEndMs));
  }, [historicalAsOf, windowStartMs, windowEndMs]);

  const applyStep = useCallback(
    (step: number) => {
      if (step >= TIMELINE_SLIDER_STEPS) {
        if (isLiveRightEdge) {
          returnTimelineToLive();
          return;
        }
        const iso = new Date(windowEndMs).toISOString();
        if (iso === historicalAsOf$.value) return;
        setHistoricalAsOf(iso);
        return;
      }

      const iso = isoFromSliderStep(step, windowStartMs, windowEndMs);
      if (iso === historicalAsOf$.value) return;
      setHistoricalAsOf(iso);
    },
    [windowStartMs, windowEndMs, isLiveRightEdge],
  );

  useEffect(() => {
    const sub = merge(scrub$.pipe(debounceTime(SCRUB_DEBOUNCE_MS)), flush$).subscribe((step) =>
      void applyStep(step),
    );
    return () => sub.unsubscribe();
  }, [applyStep, flush$, scrub$]);

  const onStepChange = (step: number): void => {
    setSliderStep(step);
    scrub$.next(step);
  };

  const onStepCommit = (step: number): void => {
    setSliderStep(step);
    flush$.next(step);
  };

  const modeLabel = historicalAsOf !== null ? "REPLAY" : "LIVE";
  const showLiveButton = isTimelineLiveButtonVisible(nowMs);
  const leftLabel = formatEdgeLabel(windowStartMs);
  const rightLabel = isLiveRightEdge ? "сейчас" : formatEdgeLabel(windowEndMs);

  return (
    <div className="map-timeline" aria-label="Таймлайн карты">
      <div className="map-timeline__toolbar">
        <div className="map-timeline__scales" role="group" aria-label="Масштаб таймлайна">
          {SCALE_OPTIONS.map((option) => (
            <Button
              key={option.id}
              variant={scale === option.id ? "primary" : "ghost"}
              disabled={loading}
              title={`Окно ${option.label}`}
              onClick={() => setTimelineScale(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <TimelineCalendarButton disabled={loading} />

        <div className="map-timeline__header">
          <span className={`map-timeline__mode map-timeline__mode--${modeLabel.toLowerCase()}`}>
            {modeLabel}
          </span>
          <span className="map-timeline__marker" title={markerIso}>
            {formatDateTime(markerIso)}
          </span>
          {loading && <span className="map-timeline__loading">загрузка…</span>}
        </div>

        {showLiveButton && (
          <Button
            variant="primary"
            disabled={loading}
            title="Вернуться к live-карте"
            onClick={() => void returnTimelineToLive()}
          >
            Live
          </Button>
        )}
      </div>

      <TimelineTrack
        sliderStep={sliderStep}
        windowStartMs={windowStartMs}
        windowEndMs={windowEndMs}
        scale={scale}
        leftLabel={leftLabel}
        rightLabel={rightLabel}
        ariaValueText={formatDateTime(markerIso)}
        disabled={loading}
        onStepChange={onStepChange}
        onStepCommit={onStepCommit}
      />
    </div>
  );
}
