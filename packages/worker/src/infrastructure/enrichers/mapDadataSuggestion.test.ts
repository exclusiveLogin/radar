import assert from "node:assert/strict";
import test from "node:test";
import { mapDadataSuggestion } from "./mapDadataSuggestion.js";

test("mapDadataSuggestion: city + coords + hint region", () => {
  const mapped = mapDadataSuggestion(
    {
      value: "г Таганрог, Ростовская обл",
      data: {
        city: "Таганрог",
        geo_lat: "47.239327",
        geo_lon: "38.881562",
        fias_id: "fias-1",
      },
    },
    { queryNorm: "таганрог", regionCodeHint: "RU-ROS" },
  );
  assert.ok(mapped);
  assert.equal(mapped!.placeName, "Таганрог");
  assert.equal(mapped!.regionCode, "RU-ROS");
  assert.equal(mapped!.lat, 47.239327);
  assert.equal(mapped!.lon, 38.881562);
});

test("mapDadataSuggestion: coords — region_iso_code важнее hint", () => {
  const mapped = mapDadataSuggestion(
    {
      value: "мкр Юбилейный, г Королёв",
      data: {
        settlement: "Юбилейный",
        geo_lat: "55.932836",
        geo_lon: "37.842893",
        region_iso_code: "RU-MOS",
        fias_id: "fias-yub",
      },
    },
    { queryNorm: "юбилейный", regionCodeHint: "RU-LUG" },
  );
  assert.ok(mapped);
  assert.equal(mapped!.regionCode, "RU-MOS");
});
