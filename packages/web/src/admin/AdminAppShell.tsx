import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { LiveClock, ThemeToggle } from "../shared/ds";
import { useObservable } from "../shared/hooks/useObservable";
import { adminWsStatus$ } from "../shared/realtime/adminWs";
import { startAdminStore } from "../shared/state/adminStore";
import { ADMIN_WIDGETS } from "./adminWidgetRegistry";

/**
 * Оболочка админ-панели: хедер с навигацией + 12-колоночная сетка дашбордов.
 * Реактивный контекст (выбранный канал) связывает action-панели с аналитикой.
 */
export function AdminAppShell() {
  const wsStatus = useObservable(adminWsStatus$, "connecting");

  useEffect(() => {
    startAdminStore();
  }, []);

  return (
    <div className="admin-shell">
      <header className="admin-shell__header">
        <div className="admin-shell__nav">
          <strong style={{ color: "var(--accent)", letterSpacing: "0.08em" }}>RADAR · ADMIN</strong>
          <NavLink to="/" className={({ isActive }) => (isActive ? "is-active" : "")}>
            Карта
          </NavLink>
          <NavLink to="/admin" className={({ isActive }) => (isActive ? "is-active" : "")}>
            Админка
          </NavLink>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="ds-muted" style={{ fontSize: 11 }}>
            WS: {wsStatus}
          </span>
          <LiveClock timeZone="UTC" />
          <ThemeToggle />
        </div>
      </header>

      <main className="admin-shell__stage">
        <div className="admin-grid">
          {ADMIN_WIDGETS.map(({ id, component: Widget, span }) => (
            <div key={id} className={`admin-grid__cell admin-grid__cell--${span}`}>
              <Widget />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
