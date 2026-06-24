import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isCriticalTopBarThreat,
  isWithinCriticalWindow,
  resolveThreatVisual,
  resolveThreatVisualKey,
  shouldShowRegionThreatMarker,
} from "./threat-visual.js";

test("resolveThreatVisualKey: rocket_threat", () => {
  assert.equal(resolveThreatVisualKey({ statusCode: "rocket_threat" }), "rocket");
});

test("resolveThreatVisualKey: warning+mass", () => {
  assert.equal(
    resolveThreatVisualKey({ statusCode: "warning", traits: { mass: true } }),
    "uav_mass",
  );
});

test("resolveThreatVisualKey: warning без mass", () => {
  assert.equal(resolveThreatVisualKey({ statusCode: "warning" }), "uav_danger");
});

test("resolveThreatVisualKey: rocket только по statusCode, не по stale subject", () => {
  assert.equal(
    resolveThreatVisualKey({ statusCode: "danger", eventSubject: "rocket" }),
    "rocket",
  );
  assert.equal(
    resolveThreatVisualKey({ statusCode: "warning", eventSubject: "rocket" }),
    "rocket",
  );
  assert.equal(
    resolveThreatVisualKey({ statusCode: "danger", eventSubject: "drone" }),
    "uav_danger",
  );
});

test("shouldShowRegionThreatMarker: только alarm-уровни", () => {
  assert.equal(
    shouldShowRegionThreatMarker({ statusCode: "danger", stateLevel: "orange" }),
    true,
  );
  assert.equal(
    shouldShowRegionThreatMarker({ statusCode: "danger", stateLevel: "grey" }),
    false,
    "grey с устаревшим statusCode — без маркера",
  );
  assert.equal(
    shouldShowRegionThreatMarker({ statusCode: "cleared", stateLevel: "green" }),
    false,
  );
});

test("isCriticalTopBarThreat", () => {
  assert.equal(isCriticalTopBarThreat({ statusCode: "rocket_threat" }), true);
  assert.equal(
    isCriticalTopBarThreat({ statusCode: "warning", traits: { mass: true } }),
    true,
  );
  assert.equal(isCriticalTopBarThreat({ statusCode: "warning" }), false);
  assert.equal(isCriticalTopBarThreat({ statusCode: "danger" }), false);
});

test("isWithinCriticalWindow", () => {
  const now = Date.parse("2026-06-23T12:00:00.000Z");
  assert.equal(
    isWithinCriticalWindow("2026-06-23T10:00:00.000Z", now),
    true,
  );
  assert.equal(
    isWithinCriticalWindow("2026-06-23T06:00:00.000Z", now),
    false,
  );
});

test("resolveThreatVisual: uncertain dimmed", () => {
  const visual = resolveThreatVisual({
    statusCode: "danger",
    traits: { uncertain: true },
  });
  assert.equal(visual?.dimmed, true);
});
