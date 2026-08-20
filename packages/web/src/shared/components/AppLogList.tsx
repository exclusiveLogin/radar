import type { AppLogEntry } from "../../shared/state/appLogStore";

type AppLogListProps = {
  entries: AppLogEntry[];
  /** Доп. класс на корень списка (админ-панель vs overlay). */
  className?: string;
};

/** Список записей app-log: источник + сообщение, уровень — цветной чертой. */
export function AppLogList({ entries, className }: AppLogListProps) {
  if (entries.length === 0) {
    return <p className="ds-muted">Нет событий.</p>;
  }

  return (
    <div className={className ? `app-log-list ${className}` : "app-log-list"}>
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`app-log-list__item app-log-list__item--${entry.level}`}
        >
          {entry.source ? `${entry.source}: ${entry.message}` : entry.message}
        </div>
      ))}
    </div>
  );
}
