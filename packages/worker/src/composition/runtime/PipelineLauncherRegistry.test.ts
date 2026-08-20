import assert from "node:assert/strict";
import test from "node:test";
import { WorkerLifecycle } from "../lifecycle/WorkerLifecycle.js";
import { PipelineLauncherRegistry } from "./PipelineLauncherRegistry.js";

test("PipelineLauncherRegistry wakes only the matching launcher", () => {
  const registry = new PipelineLauncherRegistry();
  let parseWakes = 0;
  let geoWakes = 0;

  registry.register({
    pipelineKey: "parse",
    runtime: "runner-platform",
    start() {},
    stop() {},
    enqueue: () => {
      parseWakes += 1;
    },
  });
  registry.register({
    pipelineKey: "geo-enrich",
    runtime: "runner-platform",
    start() {},
    stop() {},
    enqueue: () => {
      geoWakes += 1;
    },
  });

  registry.wake("parse");
  registry.wake("tracking");

  assert.equal(parseWakes, 1);
  assert.equal(geoWakes, 0);
});

test("WorkerLifecycle shuts resources down in reverse registration order", async () => {
  const lifecycle = new WorkerLifecycle();
  const stopped: string[] = [];

  lifecycle.register(() => stopped.push("transport"));
  lifecycle.register(async () => {
    stopped.push("launcher");
  });

  await lifecycle.shutdown();

  assert.deepEqual(stopped, ["launcher", "transport"]);
});
