import assert from "node:assert/strict";
import test from "node:test";
import { extractEventType } from "./extractEventType.js";

// Проверяем что кириллические окончания корректно матчатся (баг: \w не матчит кириллицу в JS).

test("«Ракетная опасность» → rocket_threat", () => {
  assert.equal(extractEventType("Белгородская область\nРакетная опасность"), "rocket_threat");
});

test("«Ракетной опасности» (родительный падеж) → rocket_threat", () => {
  assert.equal(extractEventType("Объявлен режим ракетной опасности"), "rocket_threat");
});

test("«Реактивная опасность» → rocket_threat", () => {
  assert.equal(extractEventType("Воронежская область\nРеактивная опасность"), "rocket_threat");
});

test("«отбой ракетной опасности» → cleared (отбой приоритетнее rocket_threat)", () => {
  assert.equal(extractEventType("Белгородская область — отбой ракетной опасности!"), "cleared");
});

test("«отбой реактивной опасности» → cleared", () => {
  assert.equal(extractEventType("Рязанская область\nОтбой реактивной опасности"), "cleared");
});

test("обычная опасность по БПЛА без ракеты → danger", () => {
  assert.equal(extractEventType("Ростовская область\nОпасность по БПЛА"), "danger");
});
