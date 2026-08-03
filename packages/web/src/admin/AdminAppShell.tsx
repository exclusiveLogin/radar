import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { LiveClock, Tabs, ThemeToggle } from "../shared/ds";
import {
  readActiveTab,
  writeActiveTab,
} from "../shared/state/uiPreferencesStore";
import { AdminWsBadge } from "./AdminWsBadge";
import { startAdminStore } from "../shared/state/adminStore";
import { ADMIN_LAYOUT_SECTIONS } from "./adminWidgetRegistry";

const ADMIN_ACTIVE_TAB_KEY = "admin.activeTab";

/**
 * Оболочка админ-панели: хедер + табы разделов + грид активного раздела.
 */
export function AdminAppShell() {
  const defaultTabId = ADMIN_LAYOUT_SECTIONS[0]?.id ?? "overview";
  const [activeTabId, setActiveTabId] = useState(() =>
    readActiveTab(ADMIN_ACTIVE_TAB_KEY, defaultTabId),
  );

  useEffect(() => {
    startAdminStore();
  }, []);

  const tabItems = useMemo(
    () => ADMIN_LAYOUT_SECTIONS.map((s) => ({ id: s.id, label: s.title })),
    [],
  );

  const activeSection =
    ADMIN_LAYOUT_SECTIONS.find((s) => s.id === activeTabId) ??
    ADMIN_LAYOUT_SECTIONS[0];

  const onTabChange = (id: string) => {
    setActiveTabId(id);
    writeActiveTab(ADMIN_ACTIVE_TAB_KEY, id);
  };

  return (
    <div className="admin-shell">
      <header className="admin-shell__header">
        <div className="admin-shell__nav">
          <strong className="admin-shell__brand">
            <span className="shell__logo" aria-hidden>
              ◈
            </span>
            RADAR · ADMIN
          </strong>
          <NavLink to="/" className={({ isActive }) => (isActive ? "is-active" : "")}>
            Карта
          </NavLink>
          <NavLink to="/admin" className={({ isActive }) => (isActive ? "is-active" : "")}>
            Админка
          </NavLink>
        </div>
        <div className="admin-shell__meta">
          <AdminWsBadge />
          <LiveClock timeZone="UTC" />
          <ThemeToggle />
        </div>
      </header>

      <nav className="admin-shell__tabs" aria-label="Разделы админки">
        <Tabs items={tabItems} activeId={activeSection.id} onChange={onTabChange} />
      </nav>

      <main className="admin-shell__stage">
        <section
          key={activeSection.id}
          className={`admin-section admin-section--${activeSection.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeSection.id}`}
        >
          <div className="admin-grid">
            {activeSection.widgets.map(({ id, component: Widget, span }) => (
              <div key={id} className={`admin-grid__cell admin-grid__cell--${span}`}>
                <Widget />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
