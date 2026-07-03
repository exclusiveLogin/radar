import { Injectable } from "@nestjs/common";
import {
  DEFAULT_TRACKING_PHASE_MANIFEST,
  workbookObservabilityResponseSchema,
  type ActiveWorkload,
  type PhaseRun,
  type RunHistoryEntry,
  type TrackingRebuildRun,
  type WorkbookObservabilityResponse,
  type WorkbookRegistryEntry,
  type WorkbookRunOutcome,
  type WorkloadStatus,
} from "@radar/shared";
import { PhasesAdminService } from "../phases-admin/phases-admin.service";
import { TrackingAdminService } from "../tracking-admin/tracking-admin.service";

const RUN_HISTORY_LIMIT = 20;

/**
 * Read-side агрегатор Workbook Registry / Active Workloads / Run History по всем
 * pipelineKey ("tracking"/"parse"/"geo-enrich"). Не дублирует SQL — читает только через уже
 * существующие admin-сервисы (TrackingAdminService/PhasesAdminService), которые сами читают
 * signaling/materialization-таблицы (tracking_pipeline_state, trajectory_rebuild_runs,
 * phase_definitions, phase_runs). Runner-platform internals (jobKernel/workbook) отсюда не видны.
 */
@Injectable()
export class WorkbookAdminService {
  constructor(
    private readonly tracking: TrackingAdminService,
    private readonly phases: PhasesAdminService,
  ) {}

  async getObservability(): Promise<WorkbookObservabilityResponse> {
    const [trackingStatus, trackingRuns, allPhases, phasesOverview, phaseRuns] = await Promise.all([
      this.tracking.getStatus(),
      this.tracking.listRuns(RUN_HISTORY_LIMIT),
      this.phases.listPhases(),
      this.phases.runsOverview(),
      this.phases.listRuns({ limit: RUN_HISTORY_LIMIT }),
    ]);

    const registry: WorkbookRegistryEntry[] = [
      {
        pipelineKey: "tracking",
        phases: DEFAULT_TRACKING_PHASE_MANIFEST.map((phase) => ({
          id: phase.id,
          enabled: phase.enabled,
        })),
      },
      {
        pipelineKey: "parse",
        phases: allPhases
          .filter((phase) => phase.scope === "ingestParse")
          .map((phase) => ({ id: phase.id, enabled: phase.enabled })),
      },
      {
        pipelineKey: "geo-enrich",
        phases: allPhases
          .filter((phase) => phase.scope === "geoParse")
          .map((phase) => ({ id: phase.id, enabled: phase.enabled })),
      },
    ];

    const activeWorkloads: ActiveWorkload[] = [
      ...trackingActiveWorkload(trackingStatus),
      ...phasesOverview.ingest.byPhase.flatMap((entry) =>
        phaseActiveWorkload("parse", entry.phaseId, entry.enabled, entry.activeRun, entry.coverage),
      ),
      ...phasesOverview.geo.byPhase.flatMap((entry) =>
        phaseActiveWorkload("geo-enrich", entry.phaseId, entry.enabled, entry.activeRun, entry.jobs),
      ),
    ];

    const runHistory: RunHistoryEntry[] = [
      ...trackingRuns.flatMap(trackingRunHistoryEntry),
      ...phaseRuns.flatMap((run) => phaseRunHistoryEntry(run, allPhases)),
    ]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, RUN_HISTORY_LIMIT);

    return workbookObservabilityResponseSchema.parse({ registry, activeWorkloads, runHistory });
  }
}

function trackingActiveWorkload(status: {
  enabled: boolean;
  activeRun: TrackingRebuildRun | null;
}): ActiveWorkload[] {
  if (!status.enabled && !status.activeRun) return [];
  const run = status.activeRun;
  const workloadStatus: WorkloadStatus =
    run?.status === "paused" ? "paused" : run?.status === "running" ? "running" : "waiting";
  return [
    {
      pipelineKey: "tracking",
      status: workloadStatus,
      currentPhaseId: (run?.stats?.stage as string | undefined) ?? null,
      cursor: run?.checkpoint ?? null,
      stats: run?.stats,
    },
  ];
}

function phaseActiveWorkload(
  pipelineKey: "parse" | "geo-enrich",
  phaseId: string,
  enabled: boolean,
  activeRun: PhaseRun | null,
  queueCounts: { pending: number; processing: number; done: number; failed: number },
): ActiveWorkload[] {
  const pendingWork = queueCounts.pending + queueCounts.processing;
  if (!activeRun && (!enabled || pendingWork === 0)) return [];
  const workloadStatus: WorkloadStatus = activeRun?.status === "paused" ? "paused" : "running";
  return [
    {
      pipelineKey,
      status: activeRun ? workloadStatus : "waiting",
      currentPhaseId: phaseId,
      cursor: null,
      stats: queueCounts,
    },
  ];
}

/** tracking использует "done"/"cancelled" (не "completed"/"canceled") — нормализуем к общему словарю. */
function trackingOutcome(status: TrackingRebuildRun["status"]): WorkbookRunOutcome | null {
  if (status === "done") return "completed";
  if (status === "cancelled") return "canceled";
  if (status === "failed") return "failed";
  if (status === "paused") return "paused";
  return null; // "running" — активный run уже отражён в activeWorkloads, не в истории
}

function trackingRunHistoryEntry(run: TrackingRebuildRun): RunHistoryEntry[] {
  const outcome = trackingOutcome(run.status);
  if (!outcome) return [];
  return [
    {
      runId: run.id,
      pipelineKey: "tracking",
      outcome,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: runDurationMs(run.startedAt, run.finishedAt),
      counters: numericCounters(run.stats),
    },
  ];
}

function phaseOutcome(status: PhaseRun["status"]): WorkbookRunOutcome | null {
  if (status === "completed" || status === "canceled" || status === "failed" || status === "paused") {
    return status;
  }
  return null; // "running"/"pending" — активный run уже отражён в activeWorkloads
}

function phaseRunHistoryEntry(
  run: PhaseRun,
  allPhases: Array<{ id: string; scope: string }>,
): RunHistoryEntry[] {
  const outcome = phaseOutcome(run.status);
  if (!outcome || !run.startedAt) return [];
  const phase = allPhases.find((p) => p.id === run.phaseId);
  const pipelineKey = phase?.scope === "geoParse" ? "geo-enrich" : "parse";
  return [
    {
      runId: run.id,
      pipelineKey,
      outcome,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      durationMs: runDurationMs(run.startedAt, run.finishedAt),
      counters: numericCounters(run.stats),
    },
  ];
}

function runDurationMs(startedAt: string | null, finishedAt: string | null | undefined): number | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numericCounters(source: Record<string, unknown> | undefined): Record<string, number> | undefined {
  if (!source) return undefined;
  const entries = Object.entries(source).filter((entry): entry is [string, number] => typeof entry[1] === "number");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
