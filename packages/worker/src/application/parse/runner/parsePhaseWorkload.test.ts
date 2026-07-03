import assert from "node:assert/strict";
import test from "node:test";
import type {
  IPhaseCoverageRepository,
  IPhaseRunRepository,
  PhaseCoverageStatus,
  PhaseDefinitionRecord,
  PhaseRun,
  PhaseRunStats,
} from "@radar/shared";
import { createParsePhaseWorkload, type ParsePhaseWorkloadDeps } from "./parsePhaseWorkload.js";
import type { PhaseRunner } from "../../phases/phaseRunner.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakePhase(overrides: Partial<PhaseDefinitionRecord> = {}): PhaseDefinitionRecord {
  return {
    id: "llm",
    trigger: "scheduled",
    scope: "ingestParse",
    enrichers: ["llm"],
    policy: { batchSize: 10, intervalMs: 5, minIntervalMs: 5, eagerMode: "inline" } as PhaseDefinitionRecord["policy"],
    enabled: true,
    order: 1,
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as PhaseDefinitionRecord;
}

function fakeCoverageCounts(pending: number): Record<PhaseCoverageStatus, number> {
  return { pending, processing: 0, done: 0, failed: 0 };
}

test("loadSlice reports empty when no pending coverage work", async () => {
  const phase = fakePhase();
  const runDrainCalls: unknown[] = [];
  const deps: ParsePhaseWorkloadDeps = {
    phaseRuns: {
      failStaleActiveRuns: async () => 0,
      findActiveForPhase: async () => null,
      create: async (input) => ({ id: "run-1", stats: {}, log: [], control: null, error: null, startedAt: null, finishedAt: null, ...input }) as PhaseRun,
    } as unknown as IPhaseRunRepository,
    coverage: {
      countByStatus: async () => fakeCoverageCounts(0),
    } as unknown as IPhaseCoverageRepository,
    runner: {
      runDrain: async (input: unknown) => {
        runDrainCalls.push(input);
        return { claimed: 0, processed: 0, ok: 0, failed: 0 } satisfies PhaseRunStats;
      },
    } as unknown as PhaseRunner,
  };

  const workload = createParsePhaseWorkload(deps, phase);
  await workload.runOnce();
  assert.equal(runDrainCalls.length, 0, "runDrain must not run when there is no pending work");
});

test("evaluate runs drain and publishes telemetry when pending work exists", async () => {
  const phase = fakePhase();
  const runDrainCalls: { runId: string }[] = [];
  const deps: ParsePhaseWorkloadDeps = {
    phaseRuns: {
      failStaleActiveRuns: async () => 0,
      findActiveForPhase: async () => null,
      create: async () => ({ id: "run-42", stats: {}, log: [], control: null, error: null, startedAt: null, finishedAt: null, phaseId: phase.id, trigger: "scheduled", status: "pending" }) as PhaseRun,
    } as unknown as IPhaseRunRepository,
    coverage: {
      countByStatus: async () => fakeCoverageCounts(3),
    } as unknown as IPhaseCoverageRepository,
    runner: {
      runDrain: async (input: { runId: string }) => {
        runDrainCalls.push(input);
        return { claimed: 3, processed: 3, ok: 3, failed: 0 } satisfies PhaseRunStats;
      },
    } as unknown as PhaseRunner,
  };

  const workload = createParsePhaseWorkload(deps, phase);
  const received: unknown[] = [];
  const phaseKeys: (string | undefined)[] = [];
  workload.telemetry.subscribe((envelope) => {
    received.push(envelope.payload);
    phaseKeys.push(envelope.phaseKey);
  });

  await workload.runOnce();

  assert.equal(runDrainCalls.length, 1);
  assert.equal(runDrainCalls[0]!.runId, "run-42");
  assert.deepEqual(received, [{ phaseId: phase.id, stats: { claimed: 3, processed: 3, ok: 3, failed: 0 } }]);
  assert.deepEqual(phaseKeys, [`parse.${phase.id}`], "naming disambiguation: phaseKey = pipelineKey.phaseId");
});

test("loadSlice skips when a run is already active for the phase (no double-drain)", async () => {
  const phase = fakePhase();
  let runDrainCalled = false;
  const deps: ParsePhaseWorkloadDeps = {
    phaseRuns: {
      failStaleActiveRuns: async () => 0,
      findActiveForPhase: async () => ({ id: "active-run" }) as PhaseRun,
      create: async () => {
        throw new Error("must not create a new run while one is active");
      },
    } as unknown as IPhaseRunRepository,
    coverage: {
      countByStatus: async () => fakeCoverageCounts(5),
    } as unknown as IPhaseCoverageRepository,
    runner: {
      runDrain: async () => {
        runDrainCalled = true;
        return { claimed: 0, processed: 0, ok: 0, failed: 0 } satisfies PhaseRunStats;
      },
    } as unknown as PhaseRunner,
  };

  const workload = createParsePhaseWorkload(deps, phase);
  await workload.runOnce();
  await sleep(5);
  assert.equal(runDrainCalled, false);
});
