import assert from "node:assert/strict";
import test from "node:test";
import { createJobKernel } from "./jobKernel.js";
import { createTelemetryBus } from "./telemetryBus.js";
import type { CursorStore } from "./cursorEngine.js";
import type { PipelineCallbacks } from "./runnerContracts.js";

function memoryCursorStore(initial: number): CursorStore<number> {
  let value = initial;
  return {
    read: async () => value,
    write: async (next) => {
      value = next;
    },
    reset: async () => {
      value = initial;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("runOnce: loads slice, evaluates, materializes, advances cursor", async () => {
  const cursorStore = memoryCursorStore(0);
  const materialized: number[] = [];
  const callbacks: PipelineCallbacks<number, number, number> = {
    loadSlice: async (cursor) =>
      cursor < 3 ? { slice: cursor, isEmpty: false } : { slice: 0, isEmpty: true },
    evaluate: async (slice) => ({ artifact: slice * 10, nextCursor: slice + 1 }),
    materialize: async (artifact) => {
      materialized.push(artifact);
    },
  };
  const kernel = createJobKernel({
    pipelineKey: "test-pipeline",
    schedule: { mode: "event" },
    cursorStore,
    callbacks,
  });

  await kernel.runOnce();
  assert.equal(materialized.length, 1);
  assert.equal(materialized[0], 0);
  assert.equal(await cursorStore.read(), 1);
});

test("runOnce: empty slice does not materialize or advance cursor", async () => {
  const cursorStore = memoryCursorStore(5);
  let materializeCalls = 0;
  const callbacks: PipelineCallbacks<number, number, number> = {
    loadSlice: async () => ({ slice: 0, isEmpty: true }),
    evaluate: async (slice) => ({ artifact: slice, nextCursor: slice }),
    materialize: async () => {
      materializeCalls += 1;
    },
  };
  const kernel = createJobKernel({
    pipelineKey: "test-pipeline-empty",
    schedule: { mode: "event" },
    cursorStore,
    callbacks,
  });

  await kernel.runOnce();
  assert.equal(materializeCalls, 0);
  assert.equal(await cursorStore.read(), 5);
});

test("pause: tick does no work while paused, resume re-enables", async () => {
  const cursorStore = memoryCursorStore(0);
  let evaluateCalls = 0;
  const callbacks: PipelineCallbacks<number, number, number> = {
    loadSlice: async (cursor) => ({ slice: cursor, isEmpty: cursor >= 1 }),
    evaluate: async (slice) => {
      evaluateCalls += 1;
      return { artifact: slice, nextCursor: slice + 1 };
    },
    materialize: async () => {},
  };
  const kernel = createJobKernel({
    pipelineKey: "test-pipeline-pause",
    schedule: { mode: "event" },
    cursorStore,
    callbacks,
  });

  kernel.pause();
  await kernel.runOnce();
  assert.equal(evaluateCalls, 0, "evaluate must not run while paused");

  kernel.resume();
  await sleep(5);
  assert.equal(evaluateCalls, 1, "resume should wake the scheduler and run once");
});

test("enqueue while a tick is running coalesces into exactly one follow-up tick", async () => {
  const cursorStore = memoryCursorStore(0);
  let evaluateCalls = 0;
  let releaseFirstTick: (() => void) | undefined;
  const firstTickGate = new Promise<void>((resolve) => {
    releaseFirstTick = resolve;
  });

  const callbacks: PipelineCallbacks<number, number, number> = {
    loadSlice: async (cursor) => ({ slice: cursor, isEmpty: cursor >= 2 }),
    evaluate: async (slice) => {
      evaluateCalls += 1;
      if (evaluateCalls === 1) await firstTickGate;
      return { artifact: slice, nextCursor: slice + 1 };
    },
    materialize: async () => {},
  };
  const kernel = createJobKernel({
    pipelineKey: "test-pipeline-coalesce",
    schedule: { mode: "event" },
    cursorStore,
    callbacks,
  });

  const firstRun = kernel.runOnce();
  await sleep(5);
  kernel.enqueue();
  kernel.enqueue();
  kernel.enqueue();
  releaseFirstTick?.();
  await firstRun;
  await sleep(20);

  assert.equal(evaluateCalls, 2, "multiple enqueue calls during a tick must coalesce to one follow-up");
});

test("emitProgress publishes a durable envelope replayable to late subscribers", async () => {
  const cursorStore = memoryCursorStore(0);
  const telemetry = createTelemetryBus<number>();
  const callbacks: PipelineCallbacks<number, number, number> = {
    loadSlice: async (cursor) => ({ slice: cursor, isEmpty: cursor >= 1 }),
    evaluate: async (slice) => ({ artifact: slice + 100, nextCursor: slice + 1 }),
    materialize: async () => {},
    emitProgress: async (envelope) => telemetry.publish(envelope),
  };
  const kernel = createJobKernel({
    pipelineKey: "test-pipeline-telemetry",
    schedule: { mode: "event" },
    cursorStore,
    callbacks,
  });

  await kernel.runOnce();

  const late: number[] = [];
  telemetry.subscribe((envelope) => late.push(envelope.payload), { replayDurable: true });
  assert.deepEqual(late, [100], "late subscriber must receive replayed durable envelope");
});

test("getStatus reflects pipelineKey and pause state", () => {
  const cursorStore = memoryCursorStore(0);
  const callbacks: PipelineCallbacks<number, number, number> = {
    loadSlice: async () => ({ slice: 0, isEmpty: true }),
    evaluate: async (slice) => ({ artifact: slice, nextCursor: slice }),
    materialize: async () => {},
  };
  const kernel = createJobKernel({
    pipelineKey: "status-pipeline",
    schedule: { mode: "event" },
    cursorStore,
    callbacks,
  });

  assert.deepEqual(kernel.getStatus(), {
    pipelineKey: "status-pipeline",
    isRunning: false,
    isPaused: false,
  });
  kernel.pause();
  assert.equal(kernel.getStatus().isPaused, true);
});
