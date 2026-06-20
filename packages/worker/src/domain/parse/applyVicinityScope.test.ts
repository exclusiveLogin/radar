import assert from "node:assert/strict";
import test from "node:test";
import { computeVicinityCenter, computeVicinityRadiusM } from "./applyVicinityScope.js";

test("computeVicinityRadiusM: 3 coastal points → padded radius", () => {
  const coords = [
    { lat: 44.098, lon: 39.074 },
    { lat: 43.428, lon: 39.923 },
    { lat: 43.756, lon: 39.906 },
  ];
  const radius = computeVicinityRadiusM(coords);
  assert.ok(radius > 5000);
  const center = computeVicinityCenter(coords);
  assert.ok(center.lat > 43 && center.lat < 44.5);
});

test("computeVicinityRadiusM: single point → default", () => {
  assert.equal(computeVicinityRadiusM([{ lat: 44, lon: 39 }]), 5000);
});
