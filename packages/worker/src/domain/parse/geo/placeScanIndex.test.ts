import assert from "node:assert/strict";
import test from "node:test";
import { PlaceScanIndex } from "./placeScanIndex.js";
import { GF_P6_SCAN_ENTRIES } from "./testPlaceScanFixture.js";

test("PlaceScanIndex: longest-match region phrase", () => {
  const index = new PlaceScanIndex(GF_P6_SCAN_ENTRIES);
  const hits = index.matchRegions("Таганрог\nРостовская область\nОпасность");
  assert.ok(hits.some((h) => h.entry.regionIso === "RU-ROS"));
});

test("PlaceScanIndex: city phrase match", () => {
  const index = new PlaceScanIndex(GF_P6_SCAN_ENTRIES);
  const hits = index.matchPlacesByPhrase("г. Таганрог опасность");
  assert.ok(hits.some((h) => h.entry.name === "Таганрог"));
});

test("PlaceScanIndex: kind filter excludes region from place match", () => {
  const index = new PlaceScanIndex(GF_P6_SCAN_ENTRIES);
  const hits = index.matchPlacesByPhrase("Ростовская область");
  assert.equal(hits.length, 0);
});
