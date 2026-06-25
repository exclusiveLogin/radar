import type { ComponentType } from "react";
import type { WidgetProps } from "../widgets/widgetProps";
import { ActiveThreatsWidget } from "../widgets/active-threats/ActiveThreatsWidget";
import { SchematicMapWidget } from "../widgets/schematic-map/SchematicMapWidget";
import { GeoMapWidget } from "../widgets/geo-map/GeoMapWidget";
import { StateChangesWidget } from "../widgets/state-changes/StateChangesWidget";
import { OverviewStatsWidget } from "../widgets/overview-stats/OverviewStatsWidget";
import { TopActivityWidget } from "../widgets/top-activity/TopActivityWidget";
import { LevelTrendWidget } from "../widgets/trend/LevelTrendWidget";
import { ProvidersWidget } from "../widgets/providers/ProvidersWidget";
import { SystemStatusWidget } from "../widgets/system-status/SystemStatusWidget";
import { MessagesFeedWidget } from "../widgets/messages-feed/MessagesFeedWidget";
import { PvoReportsWidget } from "../widgets/pvo-reports/PvoReportsWidget";
import { TrackCardWidget } from "../widgets/track-card/TrackCardWidget";

export type WidgetZone = "background" | "left" | "right" | "overlay";

export type WidgetDescriptor = {
  id: string;
  title: string;
  component: ComponentType<WidgetProps>;
  defaultVisible: boolean;
  zone: WidgetZone;
  /** Панель виджета свёрнута при первом рендере. */
  defaultCollapsed?: boolean;
  /** Ключ fold-состояния панели для localStorage. */
  panelPersistenceKey?: string;
};

/** Декларативный реестр виджетов: оболочка раскладывает по зонам. */
export const WIDGETS: WidgetDescriptor[] = [
  {
    id: "geo-map",
    title: "Гео-карта",
    component: GeoMapWidget,
    defaultVisible: true,
    zone: "background",
  },
  {
    id: "overview-stats",
    title: "Обзор",
    component: OverviewStatsWidget,
    defaultVisible: true,
    zone: "left",
    panelPersistenceKey: "widget.overview-stats",
  },
  {
    id: "schematic-map",
    title: "Схема",
    component: SchematicMapWidget,
    defaultVisible: true,
    zone: "left",
    panelPersistenceKey: "widget.schematic-map",
  },
  {
    id: "active-threats",
    title: "Активные угрозы",
    component: ActiveThreatsWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
    panelPersistenceKey: "widget.active-threats",
  },
  {
    id: "state-changes",
    title: "Лента изменений",
    component: StateChangesWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
    panelPersistenceKey: "widget.state-changes",
  },
  {
    id: "messages-feed",
    title: "Сообщения",
    component: MessagesFeedWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
    panelPersistenceKey: "widget.messages-feed",
  },
  {
    id: "pvo-reports",
    title: "Сводки ПВО",
    component: PvoReportsWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
    panelPersistenceKey: "widget.pvo-reports",
  },
  {
    id: "top-activity",
    title: "Топ активности",
    component: TopActivityWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
    panelPersistenceKey: "widget.top-activity",
  },
  {
    id: "level-trend",
    title: "Динамика",
    component: LevelTrendWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
    panelPersistenceKey: "widget.level-trend",
  },
  {
    id: "providers",
    title: "Каналы",
    component: ProvidersWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
    panelPersistenceKey: "widget.providers",
  },
  {
    id: "system-status",
    title: "Система",
    component: SystemStatusWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
    panelPersistenceKey: "widget.system-status",
  },
  {
    id: "track-card",
    title: "Карточка трека",
    component: TrackCardWidget,
    defaultVisible: true,
    zone: "overlay",
    defaultCollapsed: false,
    panelPersistenceKey: "widget.track-card",
  },
];

