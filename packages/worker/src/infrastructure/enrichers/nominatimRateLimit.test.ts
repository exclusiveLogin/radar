import test from "node:test";
import assert from "node:assert/strict";
import {
  resetNominatimRateLimitForTests,
  waitNominatimSlot,
} from "./nominatimRateLimit.js";

test("waitNominatimSlot выдерживает min interval между вызовами", async () => {
  resetNominatimRateLimitForTests();
  const minMs = 50;
  const t0 = Date.now();
  await waitNominatimSlot(minMs);
  await waitNominatimSlot(minMs);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= minMs - 5, `expected >= ${minMs - 5}ms, got ${elapsed}ms`);
});
