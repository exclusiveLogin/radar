import type { ComponentType } from "react";
import { BackfillJobLogWidget } from "./widgets/BackfillJobLogWidget";
import { BackfillRunnerWidget } from "./widgets/BackfillRunnerWidget";
import { ChannelPickerWidget } from "./widgets/ChannelPickerWidget";
import { ChannelStatsWidget } from "./widgets/ChannelStatsWidget";
import { ChannelStatusWidget } from "./widgets/ChannelStatusWidget";
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

/**
 * Декларативный реестр панелей админки: оболочка раскладывает по 12-колоночной сетке.
 * Порядок задаёт визуальную приоритетность (сверху — контекст и управление).
 */
export const ADMIN_WIDGETS: AdminWidgetDescriptor[] = [
  { id: "channel-picker", component: ChannelPickerWidget, span: 3 },
  { id: "channel-status", component: ChannelStatusWidget, span: 3 },
  { id: "channel-stats", component: ChannelStatsWidget, span: 6 },
  { id: "backfill-runner", component: BackfillRunnerWidget, span: 6 },
  { id: "backfill-job-log", component: BackfillJobLogWidget, span: 6 },
  { id: "messages-stats", component: MessagesStatsWidget, span: 8 },
  { id: "worker-runners", component: WorkerRunnersWidget, span: 4 },
  { id: "telemetry", component: TelemetryWidget, span: 6 },
  { id: "parse-errors", component: ParseErrorsWidget, span: 6 },
];
