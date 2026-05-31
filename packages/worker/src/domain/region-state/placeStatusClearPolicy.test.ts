import assert from "node:assert/strict";
import test from "node:test";
import { planGreenPlaceStatusClear } from "./placeStatusClearPolicy.js";

test("planGreenPlaceStatusClear: каскад по региону (precision=region)", () => {
  const plan = planGreenPlaceStatusClear([
    { regionId: "uly", precision: "region" },
  ]);
  assert.deepEqual(plan.regionCascadeIds, ["uly"]);
  assert.deepEqual(plan.explicitPlaceIds, []);
});

test("planGreenPlaceStatusClear: каскад даже при синтетическом placeId региона", () => {
  const plan = planGreenPlaceStatusClear([
    { regionId: "vor", placeId: "vor-region-place", precision: "region" },
  ]);
  assert.deepEqual(plan.regionCascadeIds, ["vor"]);
  assert.deepEqual(plan.explicitPlaceIds, []);
});

test("planGreenPlaceStatusClear: точечный сброс по НП (precision=city)", () => {
  const plan = planGreenPlaceStatusClear([
    { regionId: "uly", placeId: "nik", precision: "city" },
  ]);
  assert.deepEqual(plan.regionCascadeIds, []);
  assert.deepEqual(plan.explicitPlaceIds, ["nik"]);
});

test("planGreenPlaceStatusClear: регион (каскад) + НП в одном сообщении", () => {
  const plan = planGreenPlaceStatusClear([
    { regionId: "uly", precision: "region" },
    { regionId: "uly", placeId: "nik", precision: "city" },
  ]);
  assert.deepEqual(plan.regionCascadeIds, ["uly"]);
  assert.deepEqual(plan.explicitPlaceIds, ["nik"]);
});
