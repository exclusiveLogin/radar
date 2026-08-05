import { useEffect, useState } from "react";
import { LiveBadge, LiveClock, ThemeToggle } from "../shared/ds";
import { startMapStore } from "../shared/state/mapStore";
import "../shared/state/timelineStore";
import { startMapLiveReplayEffects } from "../shared/state/mapLiveReplayEffects";
import { startTrackStoreEffects } from "../shared/state/trackStoreEffects";
import { startMessagesStore } from "../shared/state/messagesStore";
import { startStateChangesFeedStore } from "../shared/state/stateChangesFeedStore";
import { startProvidersStore } from "../shared/state/providersStore";
import { startPvoReportsStore } from "../shared/state/pvoReportsStore";
import { startTopActivityStore } from "../shared/state/topActivityStore";
import { startStatusDictionaryStore } from "../shared/state/statusDictionaryStore";
import { RegionDetailWidget } from "../widgets/region-detail/RegionDetailWidget";
import { MapTimelineBar } from "../widgets/map-timeline/MapTimelineBar";
import { MapLayersPanel } from "../widgets/map-layers/MapLayersPanel";
import { GeoMapOverlays } from "../widgets/map-overlays/GeoMapOverlays";
import { CriticalThreatsBar } from "../widgets/critical-threats/CriticalThreatsBar";
import { useObservable } from "../shared/hooks/useObservable";
import { geoMapLayers$ } from "../shared/state/mapLayerStore";
import { readWidgetVisibility, writeWidgetVisibility } from "../shared/state/uiPreferencesStore";
import { WIDGETS, type WidgetZone } from "./widgetRegistry";

/** Начальная видимость виджетов из реестра. */
function initialVisibility(): Record<string, boolean> {
  const defaults = Object.fromEntries(WIDGETS.map((w) => [w.id, w.defaultVisible]));
  return readWidgetVisibility(defaults);
}

function widgetsByZone(zone: WidgetZone, visible: Record<string, boolean>) {
  return WIDGETS.filter((w) => w.zone === zone && visible[w.id]);
}

/**
 * OSINT-оболочка: карта фоном, glass-рейлы по бокам, плоский хедер.
 */
export function AppShell() {
  const [visible, setVisible] = useState<Record<string, boolean>>(initialVisibility);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const geoLayers = useObservable(geoMapLayers$, geoMapLayers$.value);

  useEffect(() => {
    startMapStore();
    startMapLiveReplayEffects();
    startTrackStoreEffects();
    startProvidersStore();
    startMessagesStore();
    startStateChangesFeedStore();
    startPvoReportsStore();
    startTopActivityStore();
    startStatusDictionaryStore();
  }, []);

  const toggle = (id: string): void =>
    setVisible((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeWidgetVisibility(next);
      return next;
    });

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
          <button
            type="button"
            className={`shell__layers-toggle${layersPanelOpen ? " is-open" : ""}`}
            onClick={() => setLayersPanelOpen((v) => !v)}
            aria-expanded={layersPanelOpen}
            aria-controls="map-layers-panel"
            title="Слои карты"
          >
            Слои
          </button>
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
        {/* Оверлей деталей региона — рендерится всегда, показывается при selectedRegion$ !== null */}
        <RegionDetailWidget />

        <div className="shell__map-layer">
          {background.map(({ id, component: Widget, panelPersistenceKey }) => (
            <Widget key={id} panelPersistenceKey={panelPersistenceKey} />
          ))}
        </div>

        <GeoMapOverlays />
        {layersPanelOpen && (
          <MapLayersPanel onClose={() => setLayersPanelOpen(false)} />
        )}

        <div className="map-top-dock">
          <CriticalThreatsBar />
        </div>

        <aside className="shell__rail shell__rail--left">
          {left.map(({ id, component: Widget, panelPersistenceKey }) => (
            <div
              key={id}
              className={`shell__rail-item${id === "overview-stats" ? " shell__rail-item--overview" : ""}`}
            >
              <Widget panelPersistenceKey={panelPersistenceKey} />
            </div>
          ))}
        </aside>

        <aside className="shell__rail shell__rail--right">
          {right.map(({ id, component: Widget, defaultCollapsed, panelPersistenceKey }) => (
            <div key={id} className="shell__rail-item">
              <Widget
                defaultCollapsed={defaultCollapsed}
                panelPersistenceKey={panelPersistenceKey}
              />
            </div>
          ))}
        </aside>

        {geoLayers.timeline && (
          <div className="map-bottom-dock">
            <MapTimelineBar />
          </div>
        )}
      </main>
    </div>
  );
}
