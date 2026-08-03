import type { ReactNode } from "react";

export type TabItem = {
  id: string;
  label: ReactNode;
  /** Опциональный бейдж справа от ярлыка (счётчик и т.п.). */
  badge?: ReactNode;
};

type TabsProps = {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
};

/**
 * Controlled-табы без роутинга: ряд кнопок + aria-роли.
 * Контент рендерит родитель по activeId.
 */
export function Tabs({ items, activeId, onChange, className }: TabsProps) {
  return (
    <div
      className={`ds-tabs${className ? ` ${className}` : ""}`}
      role="tablist"
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={isActive}
            className={`ds-tabs__tab${isActive ? " is-active" : ""}`}
            onClick={() => onChange(item.id)}
          >
            <span className="ds-tabs__label">{item.label}</span>
            {item.badge != null && (
              <span className="ds-tabs__badge">{item.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
