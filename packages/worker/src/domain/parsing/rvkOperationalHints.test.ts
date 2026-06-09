import assert from "node:assert/strict";
import test from "node:test";
import { classifyContentKind } from "./classifyContentKind.js";
import { extractEventType } from "./extractEventType.js";

test("classifyContentKind: дрон в небе — event", () => {
  assert.equal(
    classifyContentKind("Луганск дрон в небе. Осторожно"),
    "event",
  );
});

test("classifyContentKind: пролёт БПЛА — event", () => {
  assert.equal(
    classifyContentKind("В направлении Новоазовска пролет 2-ух БПЛА"),
    "event",
  );
});

test("extractEventType: дрон в небе — attention", () => {
  assert.equal(
    extractEventType("Луганск дрон в небе. Осторожно"),
    "attention",
  );
});

test("extractEventType: пролёт БПЛА — fixation", () => {
  assert.equal(
    extractEventType("В направлении Новоазовска пролет 2-ух БПЛА"),
    "fixation",
  );
});

test("extractEventType: БПЛА над городом — attention", () => {
  assert.equal(
    extractEventType("Мариуполь | БПЛА все ещё над городом. Осторожно"),
    "attention",
  );
});
