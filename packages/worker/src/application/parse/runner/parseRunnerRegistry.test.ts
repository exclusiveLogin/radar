import assert from "node:assert/strict";
import test from "node:test";
import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  PhaseDefinitionRecord,
} from "@radar/shared";
import { ParseRunnerRegistry, type ParseRunnerRegistryDeps } from "./parseRunnerRegistry.js";
import { createPhaseRunSession } from "../../phases/phaseRunSession.js";
import type { ParsePhaseTool } from "../parsePhaseTool.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakePhase(id: string): PhaseDefinitionRecord {
  return {
    id,
    triggerMode: "both",
    scope: "ingestParse",
    enrichers: ["llm"],
    policy: { batchSize: 10, intervalMs: 60_000, minIntervalMs: 60_000, eagerMode: "queue" } as PhaseDefinitionRecord["policy"],
    enabled: true,
    order: 1,
    updatedAt: new Date().toISOString(),
  };
}

function buildDeps(
  listEnabled: () => Promise<PhaseDefinitionRecord[]>,
  drainCalls: string[],
): ParseRunnerRegistryDeps {
  const phaseRuns = {
    failStaleActiveRuns: async () => 0,
    findActiveForPhase: async () => null,
    create: async () => ({ id: "run-1" }) as never,
    updateStats: async () => undefined,
    updateStatus: async () => undefined,
    clearControl: async () => undefined,
    getControl: async () => null,
    findById: async () => ({ id: "run-1", status: "running" }) as never,
    appendLog: async () => undefined,
  } as unknown as IPhaseRunRepository;

  return {
    phases: { listEnabled } as unknown as IPhaseDefinitionRepository,
    phaseRuns,
    coverage: {
      countByStatus: async () => ({ pending: 1, processing: 0, done: 0, failed: 0 }),
      enqueueCatchUp: async () => ({ enqueued: 1 }),
      claimBatch: async (phaseId: string) => [
        { id: `cov-${phaseId}`, rawMessageId: `raw-${phaseId}`, phaseId },
      ],
      markDone: async () => undefined,
      markFailed: async () => undefined,
    } as unknown as IPhaseCoverageRepository,
    placeJobs: {
      countByStatus: async () => ({ pending: 0, processing: 0, done: 0, failed: 0 }),
    } as never,
    session: createPhaseRunSession(phaseRuns),
    parseTool: {
      run: async (phase: PhaseDefinitionRecord) => {
        drainCalls.push(phase.id);
      },
      createHandler: () => {
        throw new Error("unused");
      },
    } as unknown as ParsePhaseTool,
  };
}

test("start() creates a workload per enabled phase and ticks it immediately", async () => {
  const drainCalls: string[] = [];
  const deps = buildDeps(async () => [fakePhase("llm"), fakePhase("dadata")], drainCalls);
  const registry = new ParseRunnerRegistry(deps);

  registry.start();
  await sleep(50);
  await registry.stop();

  assert.deepEqual(new Set(drainCalls), new Set(["llm", "dadata"]));
});

test("enqueueAll() wakes every currently-registered workload (Wave 6 chaining)", async () => {
  const drainCalls: string[] = [];
  const deps = buildDeps(async () => [fakePhase("llm")], drainCalls);
  const registry = new ParseRunnerRegistry(deps);

  registry.start();
  await sleep(50);
  const callsAfterStart = drainCalls.length;
  assert.ok(callsAfterStart >= 1, "start() must tick the workload at least once");

  registry.enqueueAll();
  await sleep(50);
  await registry.stop();

  assert.ok(drainCalls.length > callsAfterStart, "enqueueAll() must trigger another tick");
});

test("refresh() drops workloads for phases no longer enabled and adds new ones", async () => {
  const drainCalls: string[] = [];
  let phases: PhaseDefinitionRecord[] = [fakePhase("llm")];
  const deps = buildDeps(async () => phases, drainCalls);
  const registry = new ParseRunnerRegistry(deps);

  registry.start();
  await sleep(50);
  assert.ok(drainCalls.includes("llm"));

  phases = [fakePhase("nominatim")];
  await registry.refresh();
  drainCalls.length = 0;

  registry.enqueueAll();
  await sleep(50);
  await registry.stop();

  assert.ok(
    drainCalls.length > 0 && drainCalls.every((id) => id === "nominatim"),
    "llm workload must be stopped and removed, only nominatim ticks",
  );
});
