import assert from "node:assert/strict";
import test from "node:test";
import type {
  IPhaseCoverageRepository,
  IPhaseDefinitionRepository,
  IPhaseRunRepository,
  PhaseDefinitionRecord,
} from "@radar/shared";
import { ParseRunnerRegistry, type ParseRunnerRegistryDeps } from "./parseRunnerRegistry.js";
import type { PhaseRunner } from "../../phases/phaseRunner.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakePhase(id: string): PhaseDefinitionRecord {
  return {
    id,
    trigger: "scheduled",
    scope: "ingestParse",
    enrichers: ["llm"],
    policy: { batchSize: 10, intervalMs: 60_000, minIntervalMs: 60_000, eagerMode: "inline" } as PhaseDefinitionRecord["policy"],
    enabled: true,
    order: 1,
    updatedAt: new Date().toISOString(),
  } as PhaseDefinitionRecord;
}

function buildDeps(
  listEnabled: () => Promise<PhaseDefinitionRecord[]>,
  drainCalls: string[],
): ParseRunnerRegistryDeps {
  return {
    phases: { listEnabled } as unknown as IPhaseDefinitionRepository,
    phaseRuns: {
      failStaleActiveRuns: async () => 0,
      findActiveForPhase: async () => null,
      create: async () => ({ id: "run-1" }) as never,
    } as unknown as IPhaseRunRepository,
    coverage: {
      countByStatus: async () => ({ pending: 1, processing: 0, done: 0, failed: 0 }),
    } as unknown as IPhaseCoverageRepository,
    runner: {
      runDrain: async (input: { phase: PhaseDefinitionRecord }) => {
        drainCalls.push(input.phase.id);
        return { claimed: 1, processed: 1, ok: 1, failed: 0 };
      },
    } as unknown as PhaseRunner,
  };
}

test("start() creates a workload per enabled phase and ticks it immediately", async () => {
  const drainCalls: string[] = [];
  const deps = buildDeps(async () => [fakePhase("llm"), fakePhase("dadata")], drainCalls);
  const registry = new ParseRunnerRegistry(deps);

  registry.start();
  await sleep(10);
  await registry.stop();

  assert.deepEqual(new Set(drainCalls), new Set(["llm", "dadata"]));
});

test("enqueueAll() wakes every currently-registered workload (Wave 6 chaining)", async () => {
  const drainCalls: string[] = [];
  const deps = buildDeps(async () => [fakePhase("llm")], drainCalls);
  const registry = new ParseRunnerRegistry(deps);

  registry.start();
  await sleep(10);
  const callsAfterStart = drainCalls.length;
  assert.ok(callsAfterStart >= 1, "start() must tick the workload at least once");

  registry.enqueueAll();
  await sleep(10);
  await registry.stop();

  assert.ok(drainCalls.length > callsAfterStart, "enqueueAll() must trigger another tick");
});

test("refresh() drops workloads for phases no longer enabled and adds new ones", async () => {
  const drainCalls: string[] = [];
  let phases: PhaseDefinitionRecord[] = [fakePhase("llm")];
  const deps = buildDeps(async () => phases, drainCalls);
  const registry = new ParseRunnerRegistry(deps);

  registry.start();
  await sleep(10);
  assert.ok(drainCalls.includes("llm"));

  phases = [fakePhase("nominatim")];
  await (registry as unknown as { refresh: () => Promise<void> }).refresh();
  // refresh() itself starts the new workload (immediate tick) — reset before the explicit wake below.
  drainCalls.length = 0;

  registry.enqueueAll();
  await sleep(10);
  await registry.stop();

  assert.ok(drainCalls.length > 0 && drainCalls.every((id) => id === "nominatim"),
    "llm workload must be stopped and removed, only nominatim ticks");
});
