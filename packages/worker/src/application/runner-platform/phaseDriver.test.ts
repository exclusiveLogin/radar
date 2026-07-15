import assert from "node:assert/strict";
import test from "node:test";
import { triggerModeToSchedule } from "./phaseDriver.js";

test("triggerModeToSchedule maps modes", () => {
  assert.deepEqual(triggerModeToSchedule("event", 5000), { mode: "event" });
  assert.deepEqual(triggerModeToSchedule("manual", 5000), { mode: "event" });
  assert.deepEqual(triggerModeToSchedule("timeout", 5000), {
    mode: "interval",
    intervalMs: 5000,
  });
  assert.deepEqual(triggerModeToSchedule("both", 5000), {
    mode: "hybrid",
    intervalMs: 5000,
  });
  assert.deepEqual(triggerModeToSchedule(undefined, 5000), {
    mode: "hybrid",
    intervalMs: 5000,
  });
});
