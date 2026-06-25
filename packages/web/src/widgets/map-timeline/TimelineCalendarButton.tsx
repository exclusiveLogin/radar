import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ds";
import {
  setTimelineAnchorEnd,
  todayMskDateInput,
  endOfDayMskIso,
  timelineAnchorEnd$,
} from "../../shared/state/timelineStore";
import { useObservable } from "../../shared/hooks/useObservable";

type TimelineCalendarButtonProps = {
  disabled?: boolean;
};

/** Иконка календаря + popover выбора даты (правая граница окна). */
export function TimelineCalendarButton({ disabled = false }: TimelineCalendarButtonProps) {
  const anchorEnd = useObservable(timelineAnchorEnd$, null);
  const [open, setOpen] = useState(false);
  const [dateInput, setDateInput] = useState(() => todayMskDateInput());
  const rootRef = useRef<HTMLDivElement>(null);

  const anchorLabel = anchorEnd
    ? new Date(anchorEnd).toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "Europe/Moscow",
      })
    : null;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const applyDate = (value: string): void => {
    const today = todayMskDateInput();
    const clamped = value > today ? today : value;
    setDateInput(clamped);
    setTimelineAnchorEnd(endOfDayMskIso(clamped));
    setOpen(false);
  };

  const resetToToday = (): void => {
    setTimelineAnchorEnd(null);
    setDateInput(todayMskDateInput());
    setOpen(false);
  };

  return (
    <div className="map-timeline__calendar" ref={rootRef}>
      <button
        type="button"
        className="map-timeline__calendar-btn"
        disabled={disabled}
        title={anchorLabel ? `Конец окна: ${anchorLabel}` : "Выбрать дату конца окна"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          className="map-timeline__calendar-icon"
          viewBox="0 0 16 16"
          width={16}
          height={16}
          aria-hidden
        >
          <rect x="1.5" y="2.5" width="13" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <line x1="1.5" y1="6" x2="14.5" y2="6" stroke="currentColor" strokeWidth="1.2" />
          <line x1="5" y1="1" x2="5" y2="4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <line x1="11" y1="1" x2="11" y2="4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        {anchorLabel && <span className="map-timeline__calendar-date">{anchorLabel}</span>}
      </button>

      {open && (
        <div className="map-timeline__calendar-popover" role="dialog" aria-label="Выбор даты">
          <label className="map-timeline__calendar-field">
            <span>Конец окна</span>
            <input
              type="date"
              value={dateInput}
              max={todayMskDateInput()}
              onChange={(event) => applyDate(event.target.value)}
            />
          </label>
          <Button variant="ghost" disabled={disabled} onClick={resetToToday}>
            Сегодня
          </Button>
        </div>
      )}
    </div>
  );
}
