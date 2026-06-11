import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRegionCodeAlias } from "./regionCodeAlias.js";

test("normalizeRegionCodeAlias: BRY → RU-BRY", () => {
  assert.equal(normalizeRegionCodeAlias("BRY"), "RU-BRY");
  assert.equal(normalizeRegionCodeAlias("bry"), "RU-BRY");
});

test("normalizeRegionCodeAlias: сохраняет полный ISO", () => {
  assert.equal(normalizeRegionCodeAlias("RU-LUG"), "RU-LUG");
});

test("normalizeRegionCodeAlias: legacy aliases", () => {
  assert.equal(normalizeRegionCodeAlias("UA-43"), "RU-CR");
});

test("normalizeRegionCodeAlias: RU-SE остаётся Северной Осетией", () => {
  assert.equal(normalizeRegionCodeAlias("RU-SE"), "RU-SE");
});
