/** Иконки trait-процессоров (repeat / uncertain / multiple) рядом с бейджом. */
export type EventTraitIconsProps = {
  repeat?: boolean;
  uncertain?: boolean;
  multiple?: boolean;
  /** Компактный ряд в истории региона. */
  compact?: boolean;
};

export function EventTraitIcons({
  repeat,
  uncertain,
  multiple,
  compact = false,
}: EventTraitIconsProps) {
  if (!repeat && !uncertain && !multiple) return null;

  const rootClass = compact
    ? "ds-event-traits ds-event-traits--compact"
    : "ds-event-traits";

  return (
    <span className={rootClass}>
      {repeat && (
        <span className="ds-event-trait ds-event-trait--repeat" title="Повторное сообщение">
          ↻
        </span>
      )}
      {uncertain && (
        <span className="ds-event-trait ds-event-trait--uncertain" title="Неподтверждённый сигнал">
          ?
        </span>
      )}
      {multiple && (
        <span className="ds-event-trait ds-event-trait--multiple" title="Множественная фиксация">
          ××
        </span>
      )}
    </span>
  );
}
