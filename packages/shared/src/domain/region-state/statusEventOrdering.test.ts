import assert from "node:assert/strict";
import test from "node:test";
import { isStaleStatusEvent } from "./statusEventOrdering.js";

test("isStaleStatusEvent: старее текущего — stale", () => {
  assert.equal(
    isStaleStatusEvent("2026-06-01T10:00:00.000Z", "2026-06-01T12:00:00.000Z"),
    true,
  );
});

test("isStaleStatusEvent: новее или равно — не stale", () => {
  assert.equal(
    isStaleStatusEvent("2026-06-01T12:00:00.000Z", "2026-06-01T10:00:00.000Z"),
    false,
  );
  assert.equal(
    isStaleStatusEvent("2026-06-01T12:00:00.000Z", "2026-06-01T12:00:00.000Z"),
    false,
  );
});
