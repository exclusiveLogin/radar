import type { ReactNode } from "react";
import type { StateLevel } from "@radar/shared";
import { LEVEL_COLORS } from "../config/mapConfig.service";

export type EventCardHeadProps = {
  /** Главная строка: регион / место / заголовок события. */
  title: string;
  level?: StateLevel;
  /** Иконка типа угрозы (ThreatIcon). */
  icon?: ReactNode;
  /** Человекочитаемая причина (statusTitle). */
  reason?: string;
  /** Цвет акцента причины (resolveThreatVisual). */
  reasonColor?: string;
  /** Trait-иконки справа от причины. */
  traits?: ReactNode;
  /** Время в шапке (короткое). */
  time?: string;
  /** Доп. действие у времени (например jump на as-of). */
  timeAction?: ReactNode;
  /** Нижняя мета-строка: код региона, источник, activity. */
  meta?: ReactNode;
  /** Тело под шапкой — акцент тянется на всю высоту карточки. */
  children?: ReactNode;
};

/**
 * Компактная карточка события в рейле:
 * акцент уровня на всю высоту → title+time → reason → meta → children.
 */
export function EventCardHead({
  title,
  level,
  icon,
  reason,
  reasonColor,
  traits,
  time,
  timeAction,
  meta,
  children,
}: EventCardHeadProps) {
  return (
    <div className="ds-event-card">
      <span
        className="ds-event-card__accent"
        style={level ? { background: LEVEL_COLORS[level] } : undefined}
        aria-hidden
      />
      <div className="ds-event-card__main">
        <div className="ds-event-card__top">
          <span className="ds-event-card__title" title={title}>
            {title}
          </span>
          {(time || timeAction) && (
            <div className="ds-event-card__time-row">
              {time && <time className="ds-event-card__time">{time}</time>}
              {timeAction}
            </div>
          )}
        </div>
        {(icon || reason || traits) && (
          <div className="ds-event-card__reason">
            {icon}
            {reason && (
              <span
                className="ds-event-card__reason-text"
                title={reason}
                style={reasonColor ? { color: reasonColor } : undefined}
              >
                {reason}
              </span>
            )}
            {traits}
          </div>
        )}
        {meta && <div className="ds-event-card__meta">{meta}</div>}
        {children && <div className="ds-event-card__body">{children}</div>}
      </div>
    </div>
  );
}
