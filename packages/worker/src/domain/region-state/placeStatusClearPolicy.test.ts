import assert from "node:assert/strict";
import test from "node:test";
import { planGreenPlaceStatusClear } from "./placeStatusClearPolicy.js";

test("planGreenPlaceStatusClear: каскад по региону без placeId", () => {
  const plan = planGreenPlaceStatusClear([{ regionId: "uly" }]);
  assert.deepEqual(plan.regionCascadeIds, ["uly"]);
  assert.deepEqual(plan.explicitPlaceIds, []);
});

test("planGreenPlaceStatusClear: точечный сброс по НП", () => {
  const plan = planGreenPlaceStatusClear([{ regionId: "uly", placeId: "nik" }]);
  assert.deepEqual(plan.regionCascadeIds, []);
  assert.deepEqual(plan.explicitPlaceIds, ["nik"]);
});

test("planGreenPlaceStatusClear: регион и НП в одном сообщении", () => {
  const plan = planGreenPlaceStatusClear([
    { regionId: "uly" },
    { regionId: "uly", placeId: "nik" },
  ]);
  assert.deepEqual(plan.regionCascadeIds, ["uly"]);
  assert.deepEqual(plan.explicitPlaceIds, ["nik"]);
});
