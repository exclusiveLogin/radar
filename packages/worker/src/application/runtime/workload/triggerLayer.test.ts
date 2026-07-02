import assert from "node:assert/strict";
import test from "node:test";
import { createTriggerLayer } from "./triggerLayer.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("fire without debounce routes immediately", () => {
  let routed = 0;
  const layer = createTriggerLayer({ onRoute: () => (routed += 1) });
  layer.fire("manual");
  assert.equal(routed, 1);
});

test("fire with debounce coalesces bursts into a single route", async () => {
  let routed = 0;
  const layer = createTriggerLayer({ debounceMs: 20, onRoute: () => (routed += 1) });
  layer.fire("bus");
  layer.fire("bus");
  layer.fire("bus");
  assert.equal(routed, 0, "route must not fire before debounce window elapses");
  await sleep(35);
  assert.equal(routed, 1);
});

test("gate rejects triggers from disallowed sources", () => {
  let routed = 0;
  const layer = createTriggerLayer({
    gate: (source) => source === "scheduler",
    onRoute: () => (routed += 1),
  });
  layer.fire("manual");
  assert.equal(routed, 0);
  layer.fire("scheduler");
  assert.equal(routed, 1);
});

test("dispose cancels a pending debounced route", async () => {
  let routed = 0;
  const layer = createTriggerLayer({ debounceMs: 15, onRoute: () => (routed += 1) });
  layer.fire("cli");
  layer.dispose();
  await sleep(25);
  assert.equal(routed, 0);
});
