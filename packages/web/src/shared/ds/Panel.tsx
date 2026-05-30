import type { ReactNode } from "react";

type PanelProps = {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Базовая панель тёмной темы с шапкой и прокручиваемым телом. */
export function Panel({ title, actions, children, className }: PanelProps) {
  return (
    <section className={`ds-panel${className ? ` ${className}` : ""}`}>
      {(title || actions) && (
        <header className="ds-panel__head">
          <span>{title}</span>
          {actions}
        </header>
      )}
      <div className="ds-panel__body">{children}</div>
    </section>
  );
}
