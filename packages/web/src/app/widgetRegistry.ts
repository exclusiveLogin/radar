import type { ComponentType } from "react";
import { ActiveThreatsWidget } from "../widgets/active-threats/ActiveThreatsWidget";
import { SchematicMapWidget } from "../widgets/schematic-map/SchematicMapWidget";
import { GeoMapWidget } from "../widgets/geo-map/GeoMapWidget";
import { StateChangesWidget } from "../widgets/state-changes/StateChangesWidget";
import { OverviewStatsWidget } from "../widgets/overview-stats/OverviewStatsWidget";
import { TopActivityWidget } from "../widgets/top-activity/TopActivityWidget";
import { LevelTrendWidget } from "../widgets/trend/LevelTrendWidget";
import { ProvidersWidget } from "../widgets/providers/ProvidersWidget";
import { SystemStatusWidget } from "../widgets/system-status/SystemStatusWidget";

export type WidgetZone = "background" | "left" | "right" | "overlay";

export type WidgetDescriptor = {
  id: string;
  title: string;
  component: ComponentType;
  defaultVisible: boolean;
  zone: WidgetZone;
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
  },
  {
    id: "state-changes",
    title: "Лента изменений",
    component: StateChangesWidget,
    defaultVisible: true,
    zone: "right",
  },
  {
    id: "top-activity",
    title: "Топ активности",
    component: TopActivityWidget,
    defaultVisible: true,
    zone: "right",
  },
  {
    id: "level-trend",
    title: "Динамика",
    component: LevelTrendWidget,
    defaultVisible: true,
    zone: "right",
  },
  {
    id: "providers",
    title: "Каналы",
    component: ProvidersWidget,
    defaultVisible: true,
    zone: "right",
  },
  {
    id: "system-status",
    title: "Система",
    component: SystemStatusWidget,
    defaultVisible: true,
    zone: "right",
  },
];
