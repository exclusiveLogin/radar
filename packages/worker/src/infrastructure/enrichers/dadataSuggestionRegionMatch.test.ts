import assert from "node:assert/strict";
import test from "node:test";
import { isDadataSuggestionRegionConsistent } from "./dadataSuggestionRegionMatch.js";

test("fallback: ДНР без region_iso, город в query", () => {
  assert.equal(
    isDadataSuggestionRegionConsistent({
      regionCodeHint: "RU-DON",
      queryNorm: "новоазовск, донецкая народная республика, россия",
      suggestion: {
        value: "Донецкая Народная респ, г Новоазовск",
        data: { city: "Новоазовск", region_iso_code: null, geo_lat: "47.11" },
      },
    }),
    true,
  );
});

test("fallback: Суровикино в Волгоградской при hint ROS — reject", () => {
  assert.equal(
    isDadataSuggestionRegionConsistent({
      regionCodeHint: "RU-ROS",
      queryNorm: "суровикино, ростовская область, россия",
      suggestion: {
        value: "Волгоградская обл, г Суровикино",
        data: { city: "Суровикино", region_iso_code: "RU-VGG" },
      },
    }),
    false,
  );
});

test("fallback: Инкерман UA-40 при hint RU-SEV — accept", () => {
  assert.equal(
    isDadataSuggestionRegionConsistent({
      regionCodeHint: "RU-SEV",
      queryNorm: "инкерман, севастополь, россия",
      suggestion: {
        value: "г Севастополь, г Инкерман",
        data: { city: "Инкерман", region_iso_code: "UA-40", geo_lat: "44.61" },
      },
    }),
    true,
  );
});

test("fallback: совпадение region_iso с hint", () => {
  assert.equal(
    isDadataSuggestionRegionConsistent({
      regionCodeHint: "RU-VGG",
      queryNorm: "суровикино, волгоградская область, россия",
      suggestion: {
        value: "Волгоградская обл, г Суровикино",
        data: { city: "Суровикино", region_iso_code: "RU-VGG" },
      },
    }),
    true,
  );
});

test("fallback: ДНР без маркера субъекта — reject", () => {
  assert.equal(
    isDadataSuggestionRegionConsistent({
      regionCodeHint: "RU-DON",
      queryNorm: "тамбов, тамбовская область, россия",
      suggestion: {
        value: "Донецкая Народная респ, г Новоазовск",
        data: { city: "Новоазовск", region_iso_code: null },
      },
    }),
    false,
  );
});
