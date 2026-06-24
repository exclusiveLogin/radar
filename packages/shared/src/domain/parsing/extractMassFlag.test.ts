import assert from "node:assert/strict";
import test from "node:test";
import { extractMassFlag } from "./extractMassFlag.js";

test("extractMassFlag: массовые пролёты", () => {
  assert.equal(
    extractMassFlag("Продолжаются массовые пролёты и сбития в Нижегородской области."),
    true,
  );
});

test("extractMassFlag: волна бпла", () => {
  assert.equal(extractMassFlag("волна бпла над городом"), true);
});

test("extractMassFlag: приготовиться без массовости", () => {
  assert.equal(
    extractMassFlag("приготовиться к возможным появлениям БПЛА"),
    false,
  );
});

test("extractMassFlag: от 3 бпла", () => {
  assert.equal(extractMassFlag("Фиксация от 3 БПЛА"), true);
});
