import { useEffect, useState } from "react";
import { startMapStore } from "../shared/state/mapStore";
import { WIDGETS } from "./widgetRegistry";

/** Начальная видимость виджетов из реестра. */
function initialVisibility(): Record<string, boolean> {
  return Object.fromEntries(WIDGETS.map((w) => [w.id, w.defaultVisible]));
}

/**
 * Оболочка: запускает стор карты, рисует тулбар с тумблерами видимости
 * и грид видимых виджетов. Сами виджеты независимы и связаны через selection store.
 */
export function AppShell() {
  const [visible, setVisible] = useState<Record<string, boolean>>(initialVisibility);

  useEffect(() => {
    startMapStore();
  }, []);

  const toggle = (id: string): void =>
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }));

  const shown = WIDGETS.filter((w) => visible[w.id]);

  return (
    <div className="shell">
      <header className="shell__toolbar">
        <strong>Radar</strong>
        <span className="ds-muted">карта операционной обстановки</span>
        <nav className="shell__toggles">
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
      </header>
      <main className="shell__grid">
        {shown.map(({ id, component: Widget }) => (
          <div key={id} className="shell__cell">
            <Widget />
          </div>
        ))}
      </main>
    </div>
  );
}
