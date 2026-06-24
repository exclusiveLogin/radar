import assert from "node:assert/strict";
import test from "node:test";
import { extractUncertainFlag } from "./extractUncertainFlag.js";

test("extractUncertainFlag: «возможно фиксация»", () => {
  assert.equal(
    extractUncertainFlag("Кузнецкий район, Пензенская область - возможно фиксация"),
    true,
  );
});

test("extractUncertainFlag: «вероятно»", () => {
  assert.equal(extractUncertainFlag("Пенза — вероятно пролёт бпла"), true);
});

test("extractUncertainFlag: без маркера", () => {
  assert.equal(extractUncertainFlag("Фиксация БПЛА над городом"), false);
});

test("extractUncertainFlag: не матчит «возможность»", () => {
  assert.equal(extractUncertainFlag("есть возможность атаки"), false);
});
