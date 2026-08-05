import assert from "node:assert/strict";
import test from "node:test";
import type {
  PhaseRun,
  PhaseRunsOverview,
  RunnerDiscoveryResponse,
} from "@radar/shared";
import { buildPipelineMonitor } from "./runnerMonitorModel.ts";

const NOW = Date.parse("2026-08-05T10:00:00.000Z");

function discovery(overrides?: {
  workloadStatus?: "idle" | "running";
  hostLastSeenAt?: string;
}): RunnerDiscoveryResponse {
  return {
    generatedAt: "2026-08-05T10:00:00.000Z",
    runtime: {
      hosts: [
        {
          hostId: "worker:parse",
          role: "parse",
          startedAt: "2026-08-04T12:00:00.000Z",
          lastSeenAt: overrides?.hostLastSeenAt ?? "2026-08-05T09:59:50.000Z",
          odpRuntime: [
            {
              pipelineKey: "parse",
              label: "ingestParse",
              runtime: "runner-platform",
            },
          ],
        },
      ],
      executors: [],
      workloads: [
        {
          workloadId: "worker:parse:parse:catalog",
          hostId: "worker:parse",
          pipelineKey: "parse",
          runtime: "runner-platform",
          status: overrides?.workloadStatus ?? "idle",
          lastTickAt: "2026-08-05T09:59:55.000Z",
        },
      ],
      triggerCounters: [],
      materializeCounters: [],
      generatedAt: "2026-08-05T10:00:00.000Z",
    },
    workbook: {
      registry: [
        {
          pipelineKey: "parse",
          phases: [{ id: "catalog", enabled: true, label: "catalog" }],
        },
        { pipelineKey: "geo-enrich", phases: [] },
        { pipelineKey: "tracking", phases: [] },
      ],
      activeWorkloads: [],
      runHistory: [],
    },
    stats: {
      rawTotal: 0,
      live: 0,
      backfill: 0,
      manual: 0,
      parsedEvents: 0,
      parsedEventsActiveRaws: 0,
      placesCatalogActive: 0,
      phaseEnrichment: [],
      geoEnrichment: [],
      parseOk: 0,
      parseFailed: 0,
      parseSkipped: 0,
      channelsTotal: 0,
      channelsListening: 0,
      providersTotal: 0,
      providersActive: 0,
      backfillJobs: {
        running: 0,
        pending: 0,
        completed: 0,
        failed: 0,
        canceled: 0,
      },
      lastRawPostedAt: null,
    },
  };
}

function runningCatalogRun(): PhaseRun {
  return {
    id: "run-1",
    phaseId: "catalog",
    trigger: "manual",
    status: "running",
    stats: {
      claimed: 10,
      processed: 10,
      ok: 9,
      failed: 1,
      pendingRemaining: 90,
      totalKnown: 100,
    },
    log: [],
    control: null,
    error: null,
    startedAt: "2026-08-05T09:58:00.000Z",
    finishedAt: null,
    createdAt: "2026-08-05T09:58:00.000Z",
    updatedAt: "2026-08-05T09:59:00.000Z",
  };
}

function overviewWithQueue(pending: number, processing = 0): PhaseRunsOverview {
  return {
    runningCount: 1,
    ingest: {
      runningCount: 1,
      byPhase: [
        {
          phaseId: "catalog",
          trigger: "eager",
          enabled: true,
          activeRun: runningCatalogRun(),
          coverage: { pending, processing, done: 0, failed: 0 },
        },
      ],
    },
    geo: { byPhase: [] },
  };
}

test("active run + queue backlog ⇒ activity running even when obs workload idle", () => {
  const snap = buildPipelineMonitor("parse", {
    discovery: discovery({ workloadStatus: "idle" }),
    phaseRuns: [runningCatalogRun()],
    phasesOverview: overviewWithQueue(90),
    parsePipeline: null,
    tracking: null,
    nowMs: NOW,
  });

  assert.equal(snap.activity, "running");
  assert.equal(snap.millStatus, "idle");
  assert.equal(snap.queue.pending, 90);
  assert.equal(snap.hostLiveness, "alive");
});

test("queue backlog without active run ⇒ draining", () => {
  const snap = buildPipelineMonitor("parse", {
    discovery: discovery({ workloadStatus: "idle" }),
    phaseRuns: [],
    phasesOverview: {
      runningCount: 0,
      ingest: {
        runningCount: 0,
        byPhase: [
          {
            phaseId: "catalog",
            trigger: "eager",
            enabled: true,
            activeRun: null,
            coverage: { pending: 12, processing: 3, done: 0, failed: 0 },
          },
        ],
      },
      geo: { byPhase: [] },
    },
    parsePipeline: null,
    tracking: null,
    nowMs: NOW,
  });

  assert.equal(snap.activity, "draining");
  assert.equal(snap.queue.pending + snap.queue.processing, 15);
});

test("stale host ⇒ offline despite queue", () => {
  const snap = buildPipelineMonitor("parse", {
    discovery: discovery({
      workloadStatus: "idle",
      hostLastSeenAt: "2026-08-05T09:00:00.000Z",
    }),
    phaseRuns: [runningCatalogRun()],
    phasesOverview: overviewWithQueue(50),
    parsePipeline: null,
    tracking: null,
    nowMs: NOW,
  });

  assert.equal(snap.hostLiveness, "stale");
  assert.equal(snap.activity, "offline");
});

test("parse rebuild running ⇒ rebuild activity", () => {
  const snap = buildPipelineMonitor("parse", {
    discovery: discovery({ workloadStatus: "idle" }),
    phaseRuns: [],
    phasesOverview: null,
    parsePipeline: {
      status: "running",
      kind: "rebuild",
      phase: "processing",
      detail: "drain",
      logTail: null,
      startedAt: "2026-08-05T09:50:00.000Z",
      finishedAt: null,
      error: null,
      totalMessages: 1000,
      processedMessages: 250,
      ok: 240,
      failed: 10,
      percentApprox: 25,
    },
    tracking: null,
    nowMs: NOW,
  });

  assert.equal(snap.activity, "rebuild");
  assert.equal(snap.rebuildPercent, 25);
  assert.equal(snap.rebuildPhase, "processing");
});
