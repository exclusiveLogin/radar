import assert from "node:assert/strict";
import test from "node:test";
import type {
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  IPlaceEnrichmentJobRepository,
  PhaseDefinitionRecord,
  PhaseRun,
  PhaseRunStats,
  PlaceEnrichmentProvider,
} from "@radar/shared";
import { createGeoEnrichRunner, type GeoEnrichRunnerDeps } from "./geoEnrichRunner.js";
import type { PhaseRunner } from "../../phases/phaseRunner.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakePhase(overrides: Partial<PhaseDefinitionRecord> = {}): PhaseDefinitionRecord {
  return {
    id: "geo-dadata",
    trigger: "scheduled",
    scope: "geoParse",
    enrichers: ["dadata"],
    policy: { batchSize: 10, intervalMs: 5, minIntervalMs: 5, eagerMode: "inline" } as PhaseDefinitionRecord["policy"],
    enabled: true,
    order: 1,
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as PhaseDefinitionRecord;
}

type JobStatusCounts = { pending: number; processing: number; done: number; failed: number };

function counts(pending: number): JobStatusCounts {
  return { pending, processing: 0, done: 0, failed: 0 };
}

test("loadSlice reports empty and evaluate skips drain when no scheduled geoParse phases", async () => {
  const runDrainCalls: unknown[] = [];
  const deps: GeoEnrichRunnerDeps = {
    phases: { listEnabled: async () => [] } as unknown as IPhaseDefinitionRepository,
    phaseRuns: {} as unknown as IPhaseRunRepository,
    placeJobs: {} as unknown as IPlaceEnrichmentJobRepository,
    runner: {
      runDrain: async (input: unknown) => {
        runDrainCalls.push(input);
        return { claimed: 0, processed: 0, ok: 0, failed: 0 } satisfies PhaseRunStats;
      },
    } as unknown as PhaseRunner,
  };

  const runner = createGeoEnrichRunner(deps);
  await runner.runOnce();
  assert.equal(runDrainCalls.length, 0);
});

test("nominatim phase is skipped while dadata queue still has pending/processing jobs", async () => {
  const dadataPhase = fakePhase({ id: "geo-dadata", enrichers: ["dadata"], order: 1 });
  const nominatimPhase = fakePhase({ id: "geo-nominatim", enrichers: ["nominatim"], order: 2 });
  const runDrainCalls: { runId: string; phase: PhaseDefinitionRecord }[] = [];
  const placeJobCounts = new Map<PlaceEnrichmentProvider, ReturnType<typeof counts>>([
    ["dadata", counts(4)],
    ["nominatim", counts(2)],
  ]);

  const deps: GeoEnrichRunnerDeps = {
    phases: {
      listEnabled: async () => [dadataPhase, nominatimPhase],
    } as unknown as IPhaseDefinitionRepository,
    phaseRuns: {
      failStaleActiveRuns: async () => 0,
      findActiveForPhase: async () => null,
      create: async (input) =>
        ({ id: `run-${input.phaseId}`, ...input }) as PhaseRun,
    } as unknown as IPhaseRunRepository,
    placeJobs: {
      countByStatus: async (provider: PlaceEnrichmentProvider) => placeJobCounts.get(provider)!,
    } as unknown as IPlaceEnrichmentJobRepository,
    runner: {
      runDrain: async (input: { runId: string; phase: PhaseDefinitionRecord }) => {
        runDrainCalls.push(input);
        return { claimed: 4, processed: 4, ok: 4, failed: 0 } satisfies PhaseRunStats;
      },
    } as unknown as PhaseRunner,
  };

  const runner = createGeoEnrichRunner(deps);
  const received: unknown[] = [];
  const phaseKeys: (string | undefined)[] = [];
  runner.telemetry.subscribe((envelope) => {
    received.push(envelope.payload);
    phaseKeys.push(envelope.phaseKey);
  });

  await runner.runOnce();

  assert.equal(runDrainCalls.length, 1, "only dadata should drain — nominatim waits for empty dadata queue");
  assert.equal(runDrainCalls[0]!.phase.id, "geo-dadata");
  assert.deepEqual(received, [
    { outcomes: [{ phaseId: "geo-dadata", provider: "dadata", stats: { claimed: 4, processed: 4, ok: 4, failed: 0 } }] },
  ]);
  assert.deepEqual(phaseKeys, ["geo-enrich.geo-dadata"], "single-phase tick gets an unambiguous phaseKey");
});

test("nominatim drains once dadata queue is empty", async () => {
  const nominatimPhase = fakePhase({ id: "geo-nominatim", enrichers: ["nominatim"], order: 1 });
  const runDrainCalls: string[] = [];

  const deps: GeoEnrichRunnerDeps = {
    phases: { listEnabled: async () => [nominatimPhase] } as unknown as IPhaseDefinitionRepository,
    phaseRuns: {
      failStaleActiveRuns: async () => 0,
      findActiveForPhase: async () => null,
      create: async (input) => ({ id: "run-nominatim", ...input }) as PhaseRun,
    } as unknown as IPhaseRunRepository,
    placeJobs: {
      countByStatus: async (provider: PlaceEnrichmentProvider) =>
        provider === "dadata" ? counts(0) : counts(3),
    } as unknown as IPlaceEnrichmentJobRepository,
    runner: {
      runDrain: async (input: { phase: PhaseDefinitionRecord }) => {
        runDrainCalls.push(input.phase.id);
        return { claimed: 3, processed: 3, ok: 3, failed: 0 } satisfies PhaseRunStats;
      },
    } as unknown as PhaseRunner,
  };

  const runner = createGeoEnrichRunner(deps);
  await runner.runOnce();
  assert.deepEqual(runDrainCalls, ["geo-nominatim"]);
});

test("drainPhase reuses an already-active run id instead of creating a new one", async () => {
  const phase = fakePhase();
  const runDrainRunIds: string[] = [];
  const deps: GeoEnrichRunnerDeps = {
    phases: { listEnabled: async () => [phase] } as unknown as IPhaseDefinitionRepository,
    phaseRuns: {
      failStaleActiveRuns: async () => 0,
      findActiveForPhase: async () => ({ id: "active-run", status: "running" }) as PhaseRun,
      create: async () => {
        throw new Error("must not create a new run while one is active");
      },
    } as unknown as IPhaseRunRepository,
    placeJobs: {
      countByStatus: async () => counts(5),
    } as unknown as IPlaceEnrichmentJobRepository,
    runner: {
      runDrain: async (input: { runId: string }) => {
        runDrainRunIds.push(input.runId);
        return { claimed: 0, processed: 0, ok: 0, failed: 0 } satisfies PhaseRunStats;
      },
    } as unknown as PhaseRunner,
  };

  const runner = createGeoEnrichRunner(deps);
  await runner.runOnce();
  await sleep(5);
  assert.deepEqual(runDrainRunIds, ["active-run"]);
});
