import type { ComponentType } from "react";
import { SchematicMapWidget } from "../widgets/schematic-map/SchematicMapWidget";
import { GeoMapWidget } from "../widgets/geo-map/GeoMapWidget";
import { WarningsWidget } from "../widgets/warnings/WarningsWidget";

export type WidgetDescriptor = {
  id: string;
  title: string;
  component: ComponentType;
  defaultVisible: boolean;
};

/** Декларативный реестр виджетов: оболочка рендерит видимые и строит тумблеры. */
export const WIDGETS: WidgetDescriptor[] = [
  {
    id: "schematic-map",
    title: "Схема",
    component: SchematicMapWidget,
    defaultVisible: true,
  },
  {
    id: "geo-map",
    title: "Гео-карта",
    component: GeoMapWidget,
    defaultVisible: false,
  },
  {
    id: "warnings",
    title: "Предупреждения",
    component: WarningsWidget,
    defaultVisible: true,
  },
];
