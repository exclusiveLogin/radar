import assert from "node:assert/strict";
import test from "node:test";
import { PlaceScanIndex } from "./placeScanIndex.js";
import { pickRegionScopeIso, resolveStemToEntry } from "./placeResolvePolicy.js";
import { GF_P6_SCAN_ENTRIES } from "./testPlaceScanFixture.js";

test("pickRegionScopeIso: один явный субъект → scope", () => {
  assert.equal(pickRegionScopeIso(["RU-NIZ"]), "RU-NIZ");
  assert.equal(pickRegionScopeIso(["RU-NIZ", "RU-ROS"]), undefined);
});

test("resolveStemToEntry: MO stem → district", () => {
  const index = new PlaceScanIndex(GF_P6_SCAN_ENTRIES);
  const resolved = resolveStemToEntry(index.entriesByStem, {
    label: "Кулебакский мо",
    kindHint: "district",
    allowDistrict: true,
  });
  assert.ok(resolved);
  assert.equal(resolved!.entry.nameStem, "кулебакский");
  assert.equal(resolved!.entry.kind, "district");
});

test("resolveStemToEntry: regionScope фильтрует чужой регион", () => {
  const index = new PlaceScanIndex(GF_P6_SCAN_ENTRIES);
  const resolved = resolveStemToEntry(index.entriesByStem, {
    label: "Таганрог",
    kindHint: "city",
    regionScopeId: "22222222-2222-2222-2222-222222222201",
  });
  assert.equal(resolved, null);
});
