import type { ComponentType } from "react";
import { BackfillJobLogWidget } from "./widgets/BackfillJobLogWidget";
import { BackfillRunnerWidget } from "./widgets/BackfillRunnerWidget";
import { ChannelPickerWidget } from "./widgets/ChannelPickerWidget";
import { ChannelStatsWidget } from "./widgets/ChannelStatsWidget";
import { ChannelStatusWidget } from "./widgets/ChannelStatusWidget";
import { ParsePipelineWidget } from "./widgets/ParsePipelineWidget";
import { PhasesWidget } from "./widgets/PhasesWidget";
import { OverviewPipelineWidget } from "./widgets/OverviewPipelineWidget";
import { PipelineMapWidget } from "./widgets/PipelineMapWidget";
import { OverviewIngestKpiWidget } from "./widgets/OverviewIngestKpiWidget";
import { OverviewParseKpiWidget } from "./widgets/OverviewParseKpiWidget";
import { OverviewInfraKpiWidget } from "./widgets/OverviewInfraKpiWidget";
import { OverviewPhaseCoverageWidget } from "./widgets/OverviewPhaseCoverageWidget";
import { OverviewGeoEnrichmentWidget } from "./widgets/OverviewGeoEnrichmentWidget";
import { ParseErrorsWidget } from "./widgets/ParseErrorsWidget";
import { TelemetryWidget } from "./widgets/TelemetryWidget";
import { WorkerRunnersWidget } from "./widgets/WorkerRunnersWidget";
import { TrackingPipelineWidget } from "./widgets/TrackingPipelineWidget";
import { TrackingStepProgressWidget } from "./widgets/TrackingStepProgressWidget";
import { TrackingKinematicsSettingsWidget } from "./widgets/TrackingKinematicsSettingsWidget";
import { TrackingRunHistoryWidget } from "./widgets/TrackingRunHistoryWidget";
import { RunnerDiscoveryWidget } from "./widgets/RunnerDiscoveryWidget";

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
 * Секции админки (= табы): обзор KPI, обогащение, ingest, backfill, треки, runners, ops.
 */
export const ADMIN_LAYOUT_SECTIONS: AdminLayoutSection[] = [
  {
    id: "overview",
    title: "Обзор",
    widgets: [
      { id: "overview-pipeline", component: OverviewPipelineWidget, span: 12 },
      { id: "pipeline-map", component: PipelineMapWidget, span: 12 },
      { id: "overview-ingest-kpi", component: OverviewIngestKpiWidget, span: 4 },
      { id: "overview-parse-kpi", component: OverviewParseKpiWidget, span: 4 },
      { id: "overview-infra-kpi", component: OverviewInfraKpiWidget, span: 4 },
      { id: "overview-phase-coverage", component: OverviewPhaseCoverageWidget, span: 12 },
      { id: "overview-geo-enrichment", component: OverviewGeoEnrichmentWidget, span: 12 },
    ],
  },
  {
    id: "enrichment",
    title: "Обогащение",
    widgets: [
      { id: "parse-pipeline", component: ParsePipelineWidget, span: 4 },
      { id: "phases", component: PhasesWidget, span: 8 },
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
    id: "tracking",
    title: "Треки",
    widgets: [
      { id: "tracking-pipeline", component: TrackingPipelineWidget, span: 12 },
      { id: "tracking-step-progress", component: TrackingStepProgressWidget, span: 12 },
      { id: "tracking-settings", component: TrackingKinematicsSettingsWidget, span: 12 },
      { id: "tracking-runs", component: TrackingRunHistoryWidget, span: 12 },
    ],
  },
  {
    id: "runner-platform",
    title: "Runner Platform",
    widgets: [{ id: "runner-discovery", component: RunnerDiscoveryWidget, span: 12 }],
  },
  {
    id: "ops",
    title: "Процессы",
    widgets: [
      { id: "worker-runners", component: WorkerRunnersWidget, span: 4 },
      { id: "telemetry", component: TelemetryWidget, span: 4 },
      { id: "parse-errors", component: ParseErrorsWidget, span: 4 },
    ],
  },
];

/** Плоский список (тесты, поиск по id). */
export const ADMIN_WIDGETS: AdminWidgetDescriptor[] = ADMIN_LAYOUT_SECTIONS.flatMap(
  (s) => s.widgets,
);
