import assert from "node:assert/strict";
import test from "node:test";
import { extractNegativeMonitoringFlag } from "./extractNegativeMonitoringFlag.js";

test("extractNegativeMonitoringFlag: фиксаций нет", () => {
  assert.equal(
    extractNegativeMonitoringFlag("Самарская область — фиксаций по-прежнему не наблюдаем, мониторим дальше."),
    true,
  );
});

test("extractNegativeMonitoringFlag: ожидаем отбой", () => {
  assert.equal(
    extractNegativeMonitoringFlag("Ульяновская область — ожидаем отбой, не наблюдаем ракет"),
    true,
  );
});

test("extractNegativeMonitoringFlag: оперативная фиксация — false", () => {
  assert.equal(extractNegativeMonitoringFlag("Кузнецкий район - возможно фиксация"), false);
});
