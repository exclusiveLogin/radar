import assert from "node:assert/strict";
import test from "node:test";
import type { RegionRecord } from "@radar/shared";
import {
  distanceKm,
  findNearestRegionByCoords,
  isCoordConsistentWithRegion,
  resolveRegionCodeForCoords,
} from "./coordRegionReconcile.js";

const lug: RegionRecord = {
  id: "lug",
  code: "RU-LUG",
  iso: "RU-LUG",
  name: "ЛНР",
  centroidLat: 48.57,
  centroidLon: 39.31,
  frontRegion: true,
  borderRegion: true,
};

const mos: RegionRecord = {
  id: "mos",
  code: "RU-MOS",
  iso: "RU-MOS",
  name: "Московская",
  centroidLat: 55.58,
  centroidLon: 37.7,
  frontRegion: false,
  borderRegion: false,
};

test("Королёв/Юбилейный далеко от центроида ЛНР", () => {
  const lat = 55.932836;
  const lon = 37.842893;
  assert.equal(isCoordConsistentWithRegion(lat, lon, lug), false);
  const nearest = findNearestRegionByCoords(lat, lon, [lug, mos]);
  assert.equal(nearest?.iso, "RU-MOS");
});

test("resolveRegionCodeForCoords: геокодер MOS при тексте LUG", () => {
  const code = resolveRegionCodeForCoords(
    {
      regionId: "00000000-0000-0000-0000-000000000000",
      regionCode: "RU-MOS",
      precision: "locality",
      source: "dadata",
      placeName: "Юбилейный",
      lat: 55.932836,
      lon: 37.842893,
    },
    lug,
    [lug, mos],
  );
  assert.equal(code, "RU-MOS");
});

test("distanceKm: порядок величин Москва — Луганск", () => {
  const km = distanceKm(55.93, 37.84, 48.57, 39.31);
  assert.ok(km > 800);
});
