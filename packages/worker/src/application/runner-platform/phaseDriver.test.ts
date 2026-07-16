import assert from "node:assert/strict";
import test from "node:test";
import { triggerModeToSchedule } from "./phaseDriver.js";

test("triggerModeToSchedule: все режимы → event (timer→RMQ wake)", () => {
  assert.deepEqual(triggerModeToSchedule("event", 5000), { mode: "event" });
  assert.deepEqual(triggerModeToSchedule("manual", 5000), { mode: "event" });
  assert.deepEqual(triggerModeToSchedule("timeout", 5000), { mode: "event" });
  assert.deepEqual(triggerModeToSchedule("both", 5000), { mode: "event" });
  assert.deepEqual(triggerModeToSchedule(undefined, 5000), { mode: "event" });
});