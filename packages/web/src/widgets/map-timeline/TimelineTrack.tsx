import { useCallback, useMemo, useRef, type ChangeEvent, type PointerEvent, type SyntheticEvent } from "react";
import type { TimelineScale } from "../../shared/state/timelineStore";
import { TIMELINE_SLIDER_STEPS } from "../../shared/state/timelineStore";
import { buildTimelineTicks } from "./timelineTicks";

type TimelineTrackProps = {
  sliderStep: number;
  windowStartMs: number;
  windowEndMs: number;
  scale: TimelineScale;
  leftLabel: string;
  rightLabel: string;
  ariaValueText: string;
  disabled?: boolean;
  onStepChange: (step: number) => void;
  onStepCommit: (step: number) => void;
};

/** Кастомный трек таймлайна: тики, thumb с pointer-drag, скрытый range для a11y. */
export function TimelineTrack({
  sliderStep,
  windowStartMs,
  windowEndMs,
  scale,
  leftLabel,
  rightLabel,
  ariaValueText,
  disabled = false,
  onStepChange,
  onStepCommit,
}: TimelineTrackProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const ticks = useMemo(
    () => buildTimelineTicks(scale, windowStartMs, windowEndMs),
    [scale, windowStartMs, windowEndMs],
  );

  const thumbRatio = sliderStep / TIMELINE_SLIDER_STEPS;

  const stepFromClientX = useCallback(
    (clientX: number): number => {
      const rail = railRef.current;
      if (!rail) return sliderStep;
      const rect = rail.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(ratio * TIMELINE_SLIDER_STEPS);
    },
    [sliderStep],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const step = stepFromClientX(event.clientX);
    onStepChange(step);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current || disabled) return;
    onStepChange(stepFromClientX(event.clientX));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onStepCommit(stepFromClientX(event.clientX));
  };

  const onRangeChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const step = Number(event.target.value);
    onStepChange(step);
  };

  const onRangeCommit = (event: SyntheticEvent<HTMLInputElement>): void => {
    onStepCommit(Number((event.target as HTMLInputElement).value));
  };

  return (
    <div className="map-timeline__track-row">
      <span className="map-timeline__edge" title={leftLabel}>
        {leftLabel}
      </span>

      <div className="map-timeline__track-wrap">
        <div
          ref={railRef}
          className={`map-timeline__rail${disabled ? " map-timeline__rail--disabled" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="map-timeline__rail-line" />
          {ticks.map((tick, index) => (
            <div
              key={`${tick.ratio}-${index}`}
              className={`map-timeline__tick${tick.major ? " map-timeline__tick--major" : ""}`}
              style={{ left: `${tick.ratio * 100}%` }}
            >
              {tick.label && (
                <span className="map-timeline__tick-label">{tick.label}</span>
              )}
            </div>
          ))}
          <div
            className="map-timeline__thumb"
            style={{ left: `${thumbRatio * 100}%` }}
            aria-hidden
          />
          <div
            className="map-timeline__fill"
            style={{ width: `${thumbRatio * 100}%` }}
            aria-hidden
          />
        </div>

        <input
          type="range"
          className="map-timeline__slider-a11y"
          min={0}
          max={TIMELINE_SLIDER_STEPS}
          step={1}
          value={sliderStep}
          disabled={disabled}
          aria-valuetext={ariaValueText}
          onChange={onRangeChange}
          onMouseUp={onRangeCommit}
          onTouchEnd={onRangeCommit}
        />
      </div>

      <span className="map-timeline__edge" title={rightLabel}>
        {rightLabel}
      </span>
    </div>
  );
}
