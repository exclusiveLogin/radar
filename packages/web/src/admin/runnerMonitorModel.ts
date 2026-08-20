import type {
  HostSnapshot,
  ObsPipelineRuntime,
  ParsePipelineStatusResponse,
  PhaseRun,
  PhaseRunStats,
  PhaseRunsOverview,
  PipelineKey,
  RunnerDiscoveryResponse,
  TrackingStatusResponse,
  WorkbookRegistryEntry,
} from "@radar/shared";

/** Порог «host alive»: heartbeat obs_hosts (poll ~10s). */
export const HOST_STALE_MS = 45_000;

export type HostLiveness = "alive" | "stale" | "missing";

/** Активность пайплайна для Runner Platform (не obs tick idle). */
export type RunnerActivity =
  | "offline"
  | "rebuild"
  | "running"
  | "draining"
  | "paused"
  | "idle";

export type QueueBacklog = {
  pending: number;
  processing: number;
};

export type PipelineMonitorSnapshot = {
  pipelineKey: PipelineKey;
  hostLiveness: HostLiveness;
  hostId: string | null;
  lastSeenAt: string | null;
  runtime: ObsPipelineRuntime | null;
  activity: RunnerActivity;
  /** Obs mill — вторичный hint, не главный бейдж. */
  millStatus: string | null;
  millLastTickAt: string | null;
  activeRun: PhaseRun | null;
  queue: QueueBacklog;
  progressStats: PhaseRunStats | null;
  rebuildPercent: number | null;
  rebuildPhase: string | null;
  trackingPercent: number | null;
  detail: string | null;
};

export type HostMonitorRow = {
  hostId: string;
  role: string;
  lastSeenAt: string;
  startedAt: string;
  liveness: HostLiveness;
  /** Что реально делает процесс: pipeline·runtime или domain duty. */
  duty: string;
  pipelines: Array<{ pipelineKey: string; runtime: ObsPipelineRuntime; label: string }>;
};

const PIPELINE_HOST_ROLE: Record<PipelineKey, string> = {
  tracking: "tracking",
  parse: "parse",
  "geo-enrich": "geo",
};

/** Роли без ODP-pipeline — domain duty для Hosts panel. */
const DOMAIN_DUTY_BY_ROLE: Record<string, string> = {
  ingest: "live ingest",
  backfill: "backfill jobs",
};

const ACTIVE_RUN = new Set(["running", "paused", "pending"]);

export type RunnerMonitorInput = {
  discovery: RunnerDiscoveryResponse;
  phaseRuns: PhaseRun[];
  phasesOverview: PhaseRunsOverview | null;
  parsePipeline: ParsePipelineStatusResponse | null;
  tracking: TrackingStatusResponse | null;
  /** Для детерминированных тестов; по умолчанию Date.now(). */
  nowMs?: number;
};

/** Role worker → pipelineKey для карточки. */
export function hostRoleForPipeline(pipelineKey: PipelineKey): string {
  return PIPELINE_HOST_ROLE[pipelineKey];
}

/** Liveness по lastSeenAt относительно now. */
export function resolveHostLiveness(
  lastSeenAt: string | null | undefined,
  nowMs: number,
  staleMs = HOST_STALE_MS,
): HostLiveness {
  if (!lastSeenAt) return "missing";
  const age = nowMs - new Date(lastSeenAt).getTime();
  if (!Number.isFinite(age)) return "missing";
  return age > staleMs ? "stale" : "alive";
}

/** Host с нужным role (первый match). */
export function findPipelineHost(
  hosts: HostSnapshot[],
  pipelineKey: PipelineKey,
): HostSnapshot | null {
  const role = hostRoleForPipeline(pipelineKey);
  return hosts.find((host) => host.role === role) ?? null;
}

/** Runtime badge: odpRuntime на host → fallback workload.runtime. */
export function resolvePipelineRuntime(
  discovery: RunnerDiscoveryResponse,
  pipelineKey: PipelineKey,
): ObsPipelineRuntime | null {
  for (const host of discovery.runtime.hosts) {
    const entry = host.odpRuntime.find((row) => row.pipelineKey === pipelineKey);
    if (entry) return entry.runtime;
  }
  const workload = discovery.runtime.workloads.find((row) => row.pipelineKey === pipelineKey);
  return workload?.runtime ?? null;
}

function phaseIdsForPipeline(
  registry: WorkbookRegistryEntry[],
  pipelineKey: PipelineKey,
): Set<string> {
  return new Set(
    registry.find((entry) => entry.pipelineKey === pipelineKey)?.phases.map((p) => p.id) ?? [],
  );
}

/** Активный phase run для parse/geo (running|paused|pending). */
export function findActivePhaseRun(
  pipelineKey: "parse" | "geo-enrich",
  runs: PhaseRun[],
  registry: WorkbookRegistryEntry[],
): PhaseRun | null {
  const phaseIds = phaseIdsForPipeline(registry, pipelineKey);
  return (
    runs.find((run) => phaseIds.has(run.phaseId) && ACTIVE_RUN.has(run.status)) ?? null
  );
}

function emptyQueue(): QueueBacklog {
  return { pending: 0, processing: 0 };
}

/** Сумма backlog ingest coverage для parse. */
export function parseQueueBacklog(overview: PhaseRunsOverview | null): QueueBacklog {
  if (!overview) return emptyQueue();
  return overview.ingest.byPhase.reduce(
    (acc, row) => ({
      pending: acc.pending + row.coverage.pending,
      processing: acc.processing + row.coverage.processing,
    }),
    emptyQueue(),
  );
}

/** Сумма backlog geo jobs. */
export function geoQueueBacklog(overview: PhaseRunsOverview | null): QueueBacklog {
  if (!overview) return emptyQueue();
  return overview.geo.byPhase.reduce(
    (acc, row) => ({
      pending: acc.pending + row.jobs.pending,
      processing: acc.processing + row.jobs.processing,
    }),
    emptyQueue(),
  );
}

function backlogTotal(queue: QueueBacklog): number {
  return queue.pending + queue.processing;
}

function millHint(
  discovery: RunnerDiscoveryResponse,
  pipelineKey: PipelineKey,
): { status: string | null; lastTickAt: string | null } {
  const workload = discovery.runtime.workloads.find((row) => row.pipelineKey === pipelineKey);
  return {
    status: workload?.status ?? null,
    lastTickAt: workload?.lastTickAt ?? null,
  };
}

/**
 * Activity parse/geo: rebuild → run → queue drain → idle.
 * Obs workload status не участвует в главном бейдже.
 */
function resolveParseGeoActivity(input: {
  hostLiveness: HostLiveness;
  rebuildRunning: boolean;
  activeRun: PhaseRun | null;
  queue: QueueBacklog;
  workbookStatus: string | null;
}): RunnerActivity {
  if (input.hostLiveness !== "alive") return "offline";
  if (input.rebuildRunning) return "rebuild";
  if (input.activeRun?.status === "paused") return "paused";
  if (input.activeRun?.status === "running" || input.activeRun?.status === "pending") {
    return "running";
  }
  if (backlogTotal(input.queue) > 0) return "draining";
  if (input.workbookStatus === "running" || input.workbookStatus === "waiting") {
    return input.workbookStatus === "waiting" ? "draining" : "running";
  }
  if (input.workbookStatus === "paused") return "paused";
  return "idle";
}

function resolveTrackingActivity(input: {
  hostLiveness: HostLiveness;
  tracking: TrackingStatusResponse | null;
}): RunnerActivity {
  if (input.hostLiveness !== "alive") return "offline";
  const tracking = input.tracking;
  if (!tracking) return "idle";
  if (tracking.paused || tracking.pipelineStatus.code === "paused") return "paused";
  if (tracking.activeRun?.status === "running") return "running";
  if ((tracking.metrics.unconsumedPipeline ?? 0) > 0) return "draining";
  if (tracking.pipelineStatus.code === "running") return "running";
  if (tracking.pipelineStatus.code === "waiting") return "draining";
  return "idle";
}

function workbookStatusFor(
  discovery: RunnerDiscoveryResponse,
  pipelineKey: PipelineKey,
): string | null {
  return (
    discovery.workbook.activeWorkloads.find((row) => row.pipelineKey === pipelineKey)?.status ??
    null
  );
}

/** Снимок одной pipeline-карточки Runner Platform. */
export function buildPipelineMonitor(
  pipelineKey: PipelineKey,
  input: RunnerMonitorInput,
): PipelineMonitorSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const host = findPipelineHost(input.discovery.runtime.hosts, pipelineKey);
  const hostLiveness = host
    ? resolveHostLiveness(host.lastSeenAt, nowMs)
    : ("missing" as const);
  const mill = millHint(input.discovery, pipelineKey);
  const runtime = resolvePipelineRuntime(input.discovery, pipelineKey);

  if (pipelineKey === "tracking") {
    const unconsumed = input.tracking?.metrics.unconsumedPipeline ?? 0;
    const activity = resolveTrackingActivity({ hostLiveness, tracking: input.tracking });
    const percent = input.tracking?.percentApprox ?? input.tracking?.metrics.percentProcessed ?? null;
    return {
      pipelineKey,
      hostLiveness,
      hostId: host?.hostId ?? null,
      lastSeenAt: host?.lastSeenAt ?? null,
      runtime,
      activity,
      millStatus: mill.status,
      millLastTickAt: mill.lastTickAt,
      activeRun: null,
      queue: { pending: unconsumed, processing: 0 },
      progressStats: null,
      rebuildPercent: null,
      rebuildPhase: null,
      trackingPercent: percent,
      detail: input.tracking?.pipelineStatus.detail ?? null,
    };
  }

  const activeRun = findActivePhaseRun(pipelineKey, input.phaseRuns, input.discovery.workbook.registry);
  const queue =
    pipelineKey === "parse"
      ? parseQueueBacklog(input.phasesOverview)
      : geoQueueBacklog(input.phasesOverview);
  const rebuildRunning =
    pipelineKey === "parse" && input.parsePipeline?.status === "running";
  const activity = resolveParseGeoActivity({
    hostLiveness,
    rebuildRunning,
    activeRun,
    queue,
    workbookStatus: workbookStatusFor(input.discovery, pipelineKey),
  });

  return {
    pipelineKey,
    hostLiveness,
    hostId: host?.hostId ?? null,
    lastSeenAt: host?.lastSeenAt ?? null,
    runtime,
    activity,
    millStatus: mill.status,
    millLastTickAt: mill.lastTickAt,
    activeRun,
    queue,
    progressStats: activeRun?.stats ?? null,
    rebuildPercent: rebuildRunning ? (input.parsePipeline?.percentApprox ?? null) : null,
    rebuildPhase: rebuildRunning ? (input.parsePipeline?.phase ?? null) : null,
    trackingPercent: null,
    detail: rebuildRunning
      ? (input.parsePipeline?.detail ?? activeRun?.phaseId ?? null)
      : (activeRun?.phaseId ?? null),
  };
}

/** Три карточки + порядок как в UI. */
export function buildRunnerMonitor(input: RunnerMonitorInput): PipelineMonitorSnapshot[] {
  const keys: PipelineKey[] = ["tracking", "parse", "geo-enrich"];
  return keys.map((key) => buildPipelineMonitor(key, input));
}

/** Строки панели Hosts: роль + duty (owned pipelines / domain), не весь ODP-каталог. */
export function buildHostMonitorRows(
  hosts: HostSnapshot[],
  nowMs = Date.now(),
): HostMonitorRow[] {
  return [...hosts]
    .sort((a, b) => a.role.localeCompare(b.role))
    .map((host) => {
      const ownedKeys = new Set(
        (Object.entries(PIPELINE_HOST_ROLE) as Array<[PipelineKey, string]>)
          .filter(([, role]) => role === host.role)
          .map(([key]) => key),
      );
      // ingest/backfill: odp не владеет pipeline — игнор stale-каталога в heartbeat
      const pipelines =
        ownedKeys.size === 0
          ? []
          : host.odpRuntime
              .filter((entry) => ownedKeys.has(entry.pipelineKey as PipelineKey))
              .map((entry) => ({
                pipelineKey: entry.pipelineKey,
                runtime: entry.runtime,
                label: entry.label,
              }));
      const duty =
        pipelines.length > 0
          ? pipelines.map((p) => `${p.pipelineKey} · ${p.runtime}`).join(", ")
          : (DOMAIN_DUTY_BY_ROLE[host.role] ?? host.role);

      return {
        hostId: host.hostId,
        role: host.role,
        lastSeenAt: host.lastSeenAt,
        startedAt: host.startedAt,
        liveness: resolveHostLiveness(host.lastSeenAt, nowMs),
        duty,
        pipelines,
      };
    });
}
