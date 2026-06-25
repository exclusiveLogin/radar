import { useState } from "react";
import type { ReactNode } from "react";
import { readPanelCollapsed, writePanelCollapsed } from "../state/uiPreferencesStore";

type PanelVariant = "default" | "glass" | "bare";

type PanelProps = {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Визуальный вариант: default, glass (blur), bare (без рамки — для карты-фона). */
  variant?: PanelVariant;
  /** Разрешить сворачивание панели. */
  collapsible?: boolean;
  /** Начальное состояние свёрнутости. */
  defaultCollapsed?: boolean;
  /** Ключ персистентности fold-состояния панели. */
  persistenceKey?: string;
};

const variantClass: Record<PanelVariant, string> = {
  default: "",
  glass: " ds-panel--glass",
  bare: " ds-panel--bare",
};

/** Базовая панель с шапкой и прокручиваемым телом. */
export function Panel({
  title,
  actions,
  children,
  className,
  variant = "default",
  collapsible = false,
  defaultCollapsed = false,
  persistenceKey,
}: PanelProps) {
  const [collapsed, setCollapsed] = useState(() =>
    persistenceKey ? readPanelCollapsed(persistenceKey, defaultCollapsed) : defaultCollapsed,
  );

  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      if (persistenceKey) writePanelCollapsed(persistenceKey, next);
      return next;
    });

  const showHead = (title || actions || collapsible) && variant !== "bare";

  return (
    <section
      className={`ds-panel${variantClass[variant]}${className ? ` ${className}` : ""}`}
    >
      {showHead && (
        <header className="ds-panel__head">
          <span>{title}</span>
          <div className="ds-panel__head-actions">
            {actions}
            {collapsible && (
              <button
                type="button"
                className="ds-panel__collapse-btn"
                onClick={toggleCollapsed}
                aria-label={collapsed ? "Развернуть" : "Свернуть"}
              >
                {collapsed ? "▸" : "▾"}
              </button>
            )}
          </div>
        </header>
      )}
      {!collapsed && <div className="ds-panel__body">{children}</div>}
    </section>
  );
}
