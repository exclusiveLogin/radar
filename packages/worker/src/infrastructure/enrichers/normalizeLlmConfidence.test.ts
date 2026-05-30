import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLlmConfidence } from "./normalizeLlmConfidence.js";

test("normalizeLlmConfidence: 0..1 без изменений", () => {
  assert.equal(normalizeLlmConfidence(0.8), 0.8);
});

test("normalizeLlmConfidence: шкала 1–5 → доля", () => {
  assert.equal(normalizeLlmConfidence(2), 0.4);
  assert.equal(normalizeLlmConfidence(5), 1);
});

test("normalizeLlmConfidence: >5 → 1", () => {
  assert.equal(normalizeLlmConfidence(10), 1);
});

test("normalizeLlmConfidence: мусор → 0", () => {
  assert.equal(normalizeLlmConfidence("n/a"), 0);
});
