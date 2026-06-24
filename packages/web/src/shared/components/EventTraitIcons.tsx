/** Иконки trait-процессоров (repeat / uncertain / multiple) рядом с бейджом. */
export type EventTraitIconsProps = {
  repeat?: boolean;
  uncertain?: boolean;
  multiple?: boolean;
  /** Массовость (trait mass) — ортогональна типу warning. */
  mass?: boolean;
  /** Компактный ряд в истории региона. */
  compact?: boolean;
};

export function EventTraitIcons({
  repeat,
  uncertain,
  multiple,
  mass,
  compact = false,
}: EventTraitIconsProps) {
  if (!repeat && !uncertain && !multiple && !mass) return null;

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
      {mass && (
        <span className="ds-event-trait ds-event-trait--mass" title="Массовость / волна">
          ⚡
        </span>
      )}
    </span>
  );
}
