import assert from "node:assert/strict";
import test from "node:test";
import { classifyContentKind } from "./classifyContentKind.js";
import { extractEventType } from "./extractEventType.js";

const AD_TEXT =
  "Друзья, очередной раз обращаем ваше внимание на интернет-магазин оригинальной техники almastore";

test("реклама с «внимание» — noise, без eventType", () => {
  assert.equal(classifyContentKind(AD_TEXT), "noise");
  assert.equal(extractEventType(AD_TEXT), null);
});

test("оперативное внимание по БПЛА — event", () => {
  const text = "Внимание! Возможна активность БПЛА в вашем направлении";
  assert.equal(classifyContentKind(text), "event");
  assert.equal(extractEventType(text), "attention");
});
