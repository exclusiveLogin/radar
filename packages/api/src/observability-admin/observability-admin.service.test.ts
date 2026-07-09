import assert from "node:assert/strict";
import test from "node:test";
import { runnerDiscoveryResponseSchema, type RuntimeObservabilitySnapshot } from "@radar/shared";
import type { ObsReadClient } from "../infrastructure/observability/create-obs-read-client.js";
import type { ReadSideQueryService } from "../read-side/read-side-query.service.js";
import type { WorkbookAdminService } from "../workbook-admin/workbook-admin.service.js";
import { ObservabilityAdminService } from "./observability-admin.service.js";

const emptyRuntime: RuntimeObservabilitySnapshot = {
  hosts: [],
  executors: [],
  workloads: [],
  triggerCounters: [],
  materializeCounters: [],
  generatedAt: "2026-07-01T00:00:00.000Z",
};

const emptyWorkbook = {
  registry: [
    { pipelineKey: "tracking" as const, phases: [] },
    { pipelineKey: "parse" as const, phases: [] },
    { pipelineKey: "geo-enrich" as const, phases: [] },
  ],
  activeWorkloads: [],
  runHistory: [],
};

const emptyStats = {
  rawTotal: 0,
  live: 0,
  backfill: 0,
  manual: 0,
  parseOk: 0,
  parseFailed: 0,
  parseSkipped: 0,
  parsedEvents: 0,
  parsedEventsActiveRaws: 0,
  channelsTotal: 0,
  channelsListening: 0,
  providersTotal: 0,
  providersActive: 0,
  placesCatalogActive: 0,
  lastRawPostedAt: null,
  backfillJobs: { pending: 0, running: 0, completed: 0, failed: 0, canceled: 0 },
  phaseEnrichment: [],
  geoEnrichment: [],
};

function fakeObsRead(runtime = emptyRuntime): ObsReadClient {
  return { fetchRuntimeSnapshot: async () => runtime };
}

function fakeWorkbook(workbook = emptyWorkbook): WorkbookAdminService {
  return { getObservability: async () => workbook } as unknown as WorkbookAdminService;
}

function fakeReadSide(stats = emptyStats): ReadSideQueryService {
  return { getStatsOverview: async () => stats } as unknown as ReadSideQueryService;
}

test("getDiscovery merges runtime + workbook + stats and validates schema", async () => {
  const service = new ObservabilityAdminService(
    fakeObsRead(),
    fakeWorkbook(),
    fakeReadSide(),
  );

  const result = await service.getDiscovery();

  assert.ok(result.generatedAt);
  assert.deepEqual(result.runtime.hosts, []);
  assert.equal(result.workbook.registry.length, 3);
  assert.equal(result.stats.rawTotal, 0);
  runnerDiscoveryResponseSchema.parse(result);
});

test("getDiscovery preserves runtime trigger counters per pipeline", async () => {
  const runtime = {
    ...emptyRuntime,
    triggerCounters: [
      { pipelineKey: "parse" as const, eventType: "tick", source: "bus", count: 42 },
    ],
    materializeCounters: [
      { pipelineKey: "tracking" as const, count: 7, updatedAt: "2026-07-01T00:00:00.000Z" },
    ],
  };

  const service = new ObservabilityAdminService(
    fakeObsRead(runtime),
    fakeWorkbook(),
    fakeReadSide(),
  );

  const result = await service.getDiscovery();

  assert.equal(result.runtime.triggerCounters[0]?.count, 42);
  assert.equal(result.runtime.materializeCounters[0]?.count, 7);
});
