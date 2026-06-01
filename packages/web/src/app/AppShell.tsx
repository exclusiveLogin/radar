import { useEffect, useState } from "react";
import { LiveBadge, LiveClock, ThemeToggle } from "../shared/ds";
import { startMapStore } from "../shared/state/mapStore";
import { startMessagesStore } from "../shared/state/messagesStore";
import { startStateChangesFeedStore } from "../shared/state/stateChangesFeedStore";
import { startProvidersStore } from "../shared/state/providersStore";
import { WIDGETS, type WidgetZone } from "./widgetRegistry";

/** Начальная видимость виджетов из реестра. */
function initialVisibility(): Record<string, boolean> {
  return Object.fromEntries(WIDGETS.map((w) => [w.id, w.defaultVisible]));
}

function widgetsByZone(zone: WidgetZone, visible: Record<string, boolean>) {
  return WIDGETS.filter((w) => w.zone === zone && visible[w.id]);
}

/**
 * OSINT-оболочка: карта фоном, glass-рейлы по бокам, ломаный хедер.
 */
export function AppShell() {
  const [visible, setVisible] = useState<Record<string, boolean>>(initialVisibility);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    startMapStore();
    startProvidersStore();
    startMessagesStore();
    startStateChangesFeedStore();
  }, []);

  const toggle = (id: string): void =>
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }));

  const background = widgetsByZone("background", visible);
  const left = widgetsByZone("left", visible);
  const right = widgetsByZone("right", visible);

  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__header-brand">
          <span className="shell__logo" aria-hidden>◈</span>
          <div>
            <strong className="shell__title">RADAR</strong>
            <span className="shell__subtitle">карта операционной обстановки</span>
          </div>
        </div>

        <div className="shell__header-center">
          <LiveClock timeZone="UTC" />
        </div>

        <div className="shell__header-actions">
          <LiveBadge />
          <ThemeToggle />
          <button
            type="button"
            className="ds-theme-toggle"
            onClick={() => setSettingsOpen((v) => !v)}
            title="Видимость виджетов"
            aria-label="Настройки виджетов"
          >
            ⚙
          </button>
        </div>
      </header>

      {settingsOpen && (
        <nav className="shell__settings">
          {WIDGETS.map((widget) => (
            <label key={widget.id} className="shell__toggle">
              <input
                type="checkbox"
                checked={visible[widget.id] ?? false}
                onChange={() => toggle(widget.id)}
              />
              {widget.title}
            </label>
          ))}
        </nav>
      )}

      <main className="shell__stage">
        <div className="shell__map-layer">
          {background.map(({ id, component: Widget }) => (
            <Widget key={id} />
          ))}
        </div>

        <aside className="shell__rail shell__rail--left">
          {left.map(({ id, component: Widget }) => (
            <div key={id} className="shell__rail-item">
              <Widget />
            </div>
          ))}
        </aside>

        <aside className="shell__rail shell__rail--right">
          {right.map(({ id, component: Widget, defaultCollapsed }) => (
            <div key={id} className="shell__rail-item">
              <Widget defaultCollapsed={defaultCollapsed} />
            </div>
          ))}
        </aside>
      </main>
    </div>
  );
}
