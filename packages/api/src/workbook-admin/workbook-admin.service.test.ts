import assert from "node:assert/strict";
import test from "node:test";
import type {
  PhaseDefinitionRecord,
  PhaseRun,
  PhaseRunsOverview,
  TrackingRebuildRun,
  TrackingStatusResponse,
} from "@radar/shared";
import { WorkbookAdminService } from "./workbook-admin.service.js";
import type { TrackingAdminService } from "../tracking-admin/tracking-admin.service.js";
import type { PhasesAdminService } from "../phases-admin/phases-admin.service.js";

function fakePhase(overrides: Partial<PhaseDefinitionRecord>): PhaseDefinitionRecord {
  return {
    id: "geo-dadata",
    trigger: "scheduled",
    scope: "geoParse",
    enrichers: ["dadata"],
    policy: { batchSize: 10, intervalMs: 5000, minIntervalMs: 5000, eagerMode: "inline" },
    enabled: true,
    order: 1,
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } as PhaseDefinitionRecord;
}

function fakePhaseRun(overrides: Partial<PhaseRun>): PhaseRun {
  return {
    id: "run-1",
    phaseId: "geo-dadata",
    trigger: "scheduled",
    status: "completed",
    stats: { claimed: 5, processed: 5, ok: 5, failed: 0 },
    log: [],
    control: null,
    error: null,
    startedAt: "2026-07-01T00:00:00.000Z",
    finishedAt: "2026-07-01T00:01:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:01:00.000Z",
    ...overrides,
  };
}

function fakeTrackingService(overrides: {
  status?: Partial<TrackingStatusResponse>;
  runs?: TrackingRebuildRun[];
}): TrackingAdminService {
  return {
    getStatus: async () =>
      ({
        enabled: true,
        paused: false,
        daemonRunning: true,
        activeRun: null,
        ...overrides.status,
      }) as unknown as TrackingStatusResponse,
    listRuns: async () => overrides.runs ?? [],
  } as unknown as TrackingAdminService;
}

function fakePhasesService(overrides: {
  allPhases?: PhaseDefinitionRecord[];
  overview?: Partial<PhaseRunsOverview>;
  runs?: PhaseRun[];
}): PhasesAdminService {
  return {
    listPhases: async () => overrides.allPhases ?? [],
    runsOverview: async () =>
      ({
        runningCount: 0,
        ingest: { runningCount: 0, byPhase: [] },
        geo: { byPhase: [] },
        ...overrides.overview,
      }) as unknown as PhaseRunsOverview,
    listRuns: async () => overrides.runs ?? [],
  } as unknown as PhasesAdminService;
}

test("registry groups phases by pipelineKey via scope (ingestParse/geoParse)", async () => {
  const service = new WorkbookAdminService(
    fakeTrackingService({}),
    fakePhasesService({
      allPhases: [
        fakePhase({ id: "llm", scope: "ingestParse" }),
        fakePhase({ id: "geo-dadata", scope: "geoParse" }),
      ],
    }),
  );

  const result = await service.getObservability();
  const parseEntry = result.registry.find((r) => r.pipelineKey === "parse");
  const geoEntry = result.registry.find((r) => r.pipelineKey === "geo-enrich");

  assert.deepEqual(parseEntry?.phases.map((p) => p.id), ["llm"]);
  assert.deepEqual(geoEntry?.phases.map((p) => p.id), ["geo-dadata"]);
});

test("active tracking run surfaces as an activeWorkload with running status", async () => {
  const service = new WorkbookAdminService(
    fakeTrackingService({
      status: {
        activeRun: {
          id: "11111111-1111-1111-1111-111111111111",
          status: "running",
          stats: { stage: "cluster" },
          checkpoint: null,
        } as unknown as TrackingRebuildRun,
      },
    }),
    fakePhasesService({}),
  );

  const result = await service.getObservability();
  const tracking = result.activeWorkloads.find((w) => w.pipelineKey === "tracking");

  assert.equal(tracking?.status, "running");
  assert.equal(tracking?.currentPhaseId, "cluster");
});

test("run history: 'running'/'pending' runs are excluded (already reflected in activeWorkloads)", async () => {
  const service = new WorkbookAdminService(
    fakeTrackingService({}),
    fakePhasesService({
      allPhases: [fakePhase({ id: "geo-dadata", scope: "geoParse" })],
      runs: [
        fakePhaseRun({ id: "run-done", status: "completed" }),
        fakePhaseRun({ id: "run-live", status: "running", finishedAt: null }),
        fakePhaseRun({ id: "run-pending", status: "pending", startedAt: null, finishedAt: null }),
      ],
    }),
  );

  const result = await service.getObservability();
  const runIds = result.runHistory.map((r) => r.runId);

  assert.ok(runIds.includes("run-done"));
  assert.ok(!runIds.includes("run-live"), "running run must not appear in history");
  assert.ok(!runIds.includes("run-pending"), "pending run has no startedAt and must be skipped");
});

test("phase run history entry resolves pipelineKey from phase scope (geoParse -> geo-enrich)", async () => {
  const service = new WorkbookAdminService(
    fakeTrackingService({}),
    fakePhasesService({
      allPhases: [fakePhase({ id: "geo-dadata", scope: "geoParse" })],
      runs: [fakePhaseRun({ id: "run-geo", phaseId: "geo-dadata", status: "completed" })],
    }),
  );

  const result = await service.getObservability();
  const entry = result.runHistory.find((r) => r.runId === "run-geo");

  assert.equal(entry?.pipelineKey, "geo-enrich");
  assert.equal(entry?.durationMs, 60_000);
});

test("response validates against workbookObservabilityResponseSchema (contract)", async () => {
  const service = new WorkbookAdminService(
    fakeTrackingService({ runs: [] }),
    fakePhasesService({
      allPhases: [fakePhase({ id: "geo-dadata", scope: "geoParse" })],
      runs: [fakePhaseRun({})],
    }),
  );

  // getObservability() itself calls workbookObservabilityResponseSchema.parse() — a thrown
  // ZodError would fail this test, so a successful resolve is the contract assertion.
  await assert.doesNotReject(() => service.getObservability());
});
