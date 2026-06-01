import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { LiveClock, ThemeToggle } from "../shared/ds";
import { useObservable } from "../shared/hooks/useObservable";
import { adminWsStatus$ } from "../shared/realtime/adminWs";
import { startAdminStore } from "../shared/state/adminStore";
import { ADMIN_LAYOUT_SECTIONS } from "./adminWidgetRegistry";

/**
 * Оболочка админ-панели: хедер + секционный дашборд (12 колонок).
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
          <strong className="admin-shell__brand">
          <span className="shell__logo" aria-hidden>◈</span>
          RADAR · ADMIN</strong>
          <NavLink to="/" className={({ isActive }) => (isActive ? "is-active" : "")}>
            Карта
          </NavLink>
          <NavLink to="/admin" className={({ isActive }) => (isActive ? "is-active" : "")}>
            Админка
          </NavLink>
        </div>
        <div className="admin-shell__meta">
          <span className="ds-muted admin-shell__ws">WS: {wsStatus}</span>
          <LiveClock timeZone="UTC" />
          <ThemeToggle />
        </div>
      </header>

      <main className="admin-shell__stage">
        {ADMIN_LAYOUT_SECTIONS.map((section) => (
          <section
            key={section.id}
            className={`admin-section admin-section--${section.id}`}
            aria-labelledby={`admin-section-${section.id}`}
          >
            <h2 id={`admin-section-${section.id}`} className="admin-section__title">
              {section.title}
            </h2>
            <div className="admin-grid">
              {section.widgets.map(({ id, component: Widget, span }) => (
                <div key={id} className={`admin-grid__cell admin-grid__cell--${span}`}>
                  <Widget />
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
