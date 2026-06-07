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

export type WidgetZone = "background" | "left" | "right" | "overlay";

export type WidgetDescriptor = {
  id: string;
  title: string;
  component: ComponentType<WidgetProps>;
  defaultVisible: boolean;
  zone: WidgetZone;
  /** Панель виджета свёрнута при первом рендере. */
  defaultCollapsed?: boolean;
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
  },
  {
    id: "schematic-map",
    title: "Схема",
    component: SchematicMapWidget,
    defaultVisible: true,
    zone: "left",
  },
  {
    id: "active-threats",
    title: "Активные угрозы",
    component: ActiveThreatsWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
  },
  {
    id: "state-changes",
    title: "Лента изменений",
    component: StateChangesWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
  },
  {
    id: "messages-feed",
    title: "Сообщения",
    component: MessagesFeedWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
  },
  {
    id: "pvo-reports",
    title: "Сводки ПВО",
    component: PvoReportsWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
  },
  {
    id: "top-activity",
    title: "Топ активности",
    component: TopActivityWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
  },
  {
    id: "level-trend",
    title: "Динамика",
    component: LevelTrendWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
  },
  {
    id: "providers",
    title: "Каналы",
    component: ProvidersWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
  },
  {
    id: "system-status",
    title: "Система",
    component: SystemStatusWidget,
    defaultVisible: true,
    zone: "right",
    defaultCollapsed: true,
  },
];

