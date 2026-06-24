import assert from "node:assert/strict";
import test from "node:test";
import { extractMultipleFixationFlag } from "./extractMultipleFixationFlag.js";

test("extractMultipleFixationFlag: множественная фиксация", () => {
  assert.equal(extractMultipleFixationFlag("Множественная фиксация БПЛА"), true);
});

test("extractMultipleFixationFlag: одиночная фиксация — false", () => {
  assert.equal(extractMultipleFixationFlag("Фиксация БПЛА"), false);
});
