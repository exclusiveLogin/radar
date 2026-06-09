import assert from "node:assert/strict";
import test from "node:test";
import {
  isMapEventOlderThanTtl,
  isPlaceSuppressedByRegionClear,
  isStaleStatusEvent,
} from "./statusEventOrdering.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("isMapEventOlderThanTtl: старше окна — true", () => {
  const ref = Date.parse("2026-06-02T12:00:00.000Z");
  assert.equal(
    isMapEventOlderThanTtl("2026-05-31T12:00:00.000Z", ref, DAY_MS),
    true,
  );
});

test("isMapEventOlderThanTtl: внутри окна — false", () => {
  const ref = Date.parse("2026-06-02T12:00:00.000Z");
  assert.equal(
    isMapEventOlderThanTtl("2026-06-02T10:00:00.000Z", ref, DAY_MS),
    false,
  );
});

test("isMapEventOlderThanTtl: ttlMs<=0 — всегда false", () => {
  assert.equal(isMapEventOlderThanTtl("2020-01-01T00:00:00.000Z", Date.now(), 0), false);
});

test("isStaleStatusEvent: старее текущего — stale", () => {
  assert.equal(
    isStaleStatusEvent("2026-06-01T10:00:00.000Z", "2026-06-01T12:00:00.000Z"),
    true,
  );
});

test("isPlaceSuppressedByRegionClear: raise региона не гасит place", () => {
  assert.equal(
    isPlaceSuppressedByRegionClear({
      placeStatusEventAt: "2026-06-01T05:00:00.000Z",
      regionStatusEventAt: "2026-06-01T12:00:00.000Z",
      regionAction: "raise",
    }),
    false,
  );
});

test("isPlaceSuppressedByRegionClear: clear региона новее place — suppress", () => {
  assert.equal(
    isPlaceSuppressedByRegionClear({
      placeStatusEventAt: "2026-06-01T05:00:00.000Z",
      regionStatusEventAt: "2026-06-01T12:00:00.000Z",
      regionAction: "clear",
    }),
    true,
  );
});

test("isPlaceSuppressedByRegionClear: одинаковый timestamp — не suppress", () => {
  assert.equal(
    isPlaceSuppressedByRegionClear({
      placeStatusEventAt: "2026-06-01T12:00:00.000Z",
      regionStatusEventAt: "2026-06-01T12:00:00.000Z",
      regionAction: "clear",
    }),
    false,
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
