import assert from "node:assert/strict";
import test from "node:test";
import { trackingPipelineConfigSchema } from "@radar/shared";
import {
  ControlTrackingRunUseCase,
  SetTrackingEnabledUseCase,
  StartTrackingRebuildUseCase,
  TrackingAdminCommandError,
  type TrackingAdminCommandPort,
} from "./tracking-admin-commands.js";

function fakePort(overrides: Partial<TrackingAdminCommandPort> = {}): TrackingAdminCommandPort {
  return {
    readConfig: async () => trackingPipelineConfigSchema.parse({}),
    saveConfig: async () => undefined,
    countUnconsumedPipeline: async () => 0,
    findControllableRunId: async () => null,
    isPipelineEnabled: async () => true,
    createRun: async () => "run-1",
    activateRun: async () => undefined,
  restartTrackingDrain: async () => ({ id: "run-rebuild" }),
    setPipelineEnabled: async () => undefined,
    getRunStatus: async () => null,
    setRunPaused: async () => undefined,
    cancelRun: async () => undefined,
    ...overrides,
  };
}

test("enabling tracking starts an incremental run only for pending work", async () => {
  const calls: string[] = [];
  const useCase = new SetTrackingEnabledUseCase(fakePort({
    countUnconsumedPipeline: async () => 3,
    createRun: async () => {
      calls.push("create");
      return "run-2";
    },
    activateRun: async (runId) => {
      calls.push(`activate:${runId}`);
    },
  }));

  const result = await useCase.execute(true);

  assert.deepEqual(result, { ok: true, enabled: true });
  assert.deepEqual(calls, ["create", "activate:run-2"]);
});

test("rebuild uses one atomic drain command", async () => {
  const useCase = new StartTrackingRebuildUseCase(fakePort({
    restartTrackingDrain: async () => ({ id: "run-atomic" }),
  }));

  await assert.doesNotReject(() => useCase.execute());
  assert.deepEqual(await useCase.execute(), { ok: true, runId: "run-atomic" });
});

test("pause rejects a disabled pipeline without creating a run", async () => {
  const useCase = new ControlTrackingRunUseCase(fakePort({
    isPipelineEnabled: async () => false,
  }));

  await assert.rejects(
    () => useCase.execute("pause"),
    (error: unknown) =>
      error instanceof TrackingAdminCommandError && error.message === "pipeline disabled",
  );
});

test("resume changes only a paused run", async () => {
  const calls: Array<[string, boolean]> = [];
  const useCase = new ControlTrackingRunUseCase(fakePort({
    findControllableRunId: async () => "run-3",
    getRunStatus: async () => "paused",
    setRunPaused: async (runId, paused) => {
      calls.push([runId, paused]);
    },
  }));

  await useCase.execute("resume");

  assert.deepEqual(calls, [["run-3", false]]);
});
