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
