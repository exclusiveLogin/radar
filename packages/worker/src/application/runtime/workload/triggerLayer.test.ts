import assert from "node:assert/strict";
import test from "node:test";
import { createTriggerLayer, type TriggerContext } from "./triggerLayer.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("fire without debounce routes immediately", () => {
  let routed = 0;
  const layer = createTriggerLayer({ onRoute: () => (routed += 1) });
  layer.fire({ source: "manual" });
  assert.equal(routed, 1);
});

test("fire with debounce coalesces bursts into a single route", async () => {
  let routed = 0;
  const layer = createTriggerLayer({ debounceMs: 20, onRoute: () => (routed += 1) });
  layer.fire({ source: "bus" });
  layer.fire({ source: "bus" });
  layer.fire({ source: "bus" });
  assert.equal(routed, 0, "route must not fire before debounce window elapses");
  await sleep(35);
  assert.equal(routed, 1);
});

test("debounce merges unique ids from successive fires", async () => {
  let last: TriggerContext | undefined;
  const layer = createTriggerLayer({
    debounceMs: 20,
    onRoute: (ctx) => {
      last = ctx;
    },
  });
  layer.fire({ source: "bus", ids: ["a", "b"] });
  layer.fire({ source: "bus", ids: ["b", "c"] });
  layer.fire({ source: "bus", topic: "radar.message.parsed" });
  await sleep(35);
  assert.deepEqual(last?.ids, ["a", "b", "c"]);
  assert.equal(last?.topic, "radar.message.parsed");
  assert.equal(last?.source, "bus");
});

test("gate rejects triggers from disallowed sources", () => {
  let routed = 0;
  const layer = createTriggerLayer({
    gate: (ctx) => ctx.source === "scheduler",
    onRoute: () => (routed += 1),
  });
  layer.fire({ source: "manual" });
  assert.equal(routed, 0);
  layer.fire({ source: "scheduler" });
  assert.equal(routed, 1);
});

test("dispose cancels a pending debounced route", async () => {
  let routed = 0;
  const layer = createTriggerLayer({ debounceMs: 15, onRoute: () => (routed += 1) });
  layer.fire({ source: "cli" });
  layer.dispose();
  await sleep(25);
  assert.equal(routed, 0);
});
