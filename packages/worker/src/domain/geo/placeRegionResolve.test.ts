import assert from "node:assert/strict";
import test from "node:test";
import { KnownLocalityCatalog } from "../../infrastructure/geo-catalog/knownLocalityCatalog.js";
import {
  lookupLocalityRegionForPlace,
  resolvePlaceRegionCodeInContext,
} from "./geographicTextContext.js";

const CATALOG = KnownLocalityCatalog.loadFromDictionaries().list();

test("Нижний Новгород 24/7 → код из справочника, не RU-NIZ чужого якоря", () => {
  const code = lookupLocalityRegionForPlace("Нижний Новгород 24/7", CATALOG);
  assert.equal(code, "52");
});

test("multi-place: не подставляем RU-NIZ вместо справочника", () => {
  const code = resolvePlaceRegionCodeInContext({
    placeName: "Нижний Новгород 24/7",
    placeRegionCode: "RU-NIZ",
    rawText: "Москва 24/7\nНижний Новгород 24/7",
    anchorsInText: [],
    localityCatalog: CATALOG,
    regionsCollected: [{ code: "RU-NIZ", name: "Нижегородская" }],
    multiPlaceContext: true,
  });
  assert.equal(code, "52");
  assert.notEqual(code, "RU-NIZ");
});
