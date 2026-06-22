import type { ComponentType } from "react";
import { BackfillJobLogWidget } from "./widgets/BackfillJobLogWidget";
import { BackfillRunnerWidget } from "./widgets/BackfillRunnerWidget";
import { ChannelPickerWidget } from "./widgets/ChannelPickerWidget";
import { ChannelStatsWidget } from "./widgets/ChannelStatsWidget";
import { ChannelStatusWidget } from "./widgets/ChannelStatusWidget";
import { PhasesWidget } from "./widgets/PhasesWidget";
import { MessagesStatsWidget } from "./widgets/MessagesStatsWidget";
import { ParseErrorsWidget } from "./widgets/ParseErrorsWidget";
import { TelemetryWidget } from "./widgets/TelemetryWidget";
import { WorkerRunnersWidget } from "./widgets/WorkerRunnersWidget";

/** Ширина ячейки в 12-колоночной сетке дашборда. */
export type AdminWidgetSpan = 3 | 4 | 6 | 8 | 12;

export type AdminWidgetDescriptor = {
  id: string;
  component: ComponentType;
  span: AdminWidgetSpan;
};

export type AdminLayoutSection = {
  id: string;
  title: string;
  widgets: AdminWidgetDescriptor[];
};

/**
 * Секции админки: сверху KPI, центр — обогащение + health, ниже ingest/backfill/ops.
 */
export const ADMIN_LAYOUT_SECTIONS: AdminLayoutSection[] = [
  {
    id: "overview",
    title: "Система",
    widgets: [{ id: "messages-stats", component: MessagesStatsWidget, span: 12 }],
  },
  {
    id: "enrichment",
    title: "Обогащение",
    widgets: [
      { id: "phases", component: PhasesWidget, span: 8 },
      { id: "worker-runners", component: WorkerRunnersWidget, span: 4 },
    ],
  },
  {
    id: "ingest",
    title: "Ingest · каналы",
    widgets: [
      { id: "channel-picker", component: ChannelPickerWidget, span: 3 },
      { id: "channel-status", component: ChannelStatusWidget, span: 3 },
      { id: "channel-stats", component: ChannelStatsWidget, span: 6 },
    ],
  },
  {
    id: "backfill",
    title: "Backfill",
    widgets: [
      { id: "backfill-runner", component: BackfillRunnerWidget, span: 12 },
      { id: "parse-attempts-log", component: BackfillJobLogWidget, span: 12 },
    ],
  },
  {
    id: "ops",
    title: "Процессы",
    widgets: [
      { id: "telemetry", component: TelemetryWidget, span: 6 },
      { id: "parse-errors", component: ParseErrorsWidget, span: 6 },
    ],
  },
];

/** Плоский список (тесты, поиск по id). */
export const ADMIN_WIDGETS: AdminWidgetDescriptor[] = ADMIN_LAYOUT_SECTIONS.flatMap(
  (s) => s.widgets,
);
