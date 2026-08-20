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

/** Шеврон сворачивания — крутится через CSS. */
function CollapseChevron() {
  return (
    <svg className="ds-panel__chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d="M4.2 6.2a.75.75 0 0 1 1.06 0L8 8.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L4.2 7.26a.75.75 0 0 1 0-1.06Z"
        fill="currentColor"
      />
    </svg>
  );
}

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
  const panelClass = [
    "ds-panel",
    variantClass[variant].trim(),
    collapsible ? "ds-panel--collapsible" : "",
    collapsed ? "is-collapsed" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={panelClass}>
      {showHead && (
        <header className="ds-panel__head">
          <span className="ds-panel__title">{title}</span>
          <div className="ds-panel__head-actions">
            {actions}
            {collapsible && (
              <button
                type="button"
                className="ds-panel__collapse-btn"
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
                aria-label={collapsed ? "Развернуть" : "Свернуть"}
              >
                <CollapseChevron />
              </button>
            )}
          </div>
        </header>
      )}

      {/* Сетка 1fr→0fr: плавное сворачивание без unmount */}
      <div className="ds-panel__collapse">
        <div className="ds-panel__body">{children}</div>
      </div>
    </section>
  );
}
