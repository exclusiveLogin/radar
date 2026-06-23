import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveCatalogGeoFeatureCentroid,
  resolvePlaceEnrichedCentroid,
  resolvePlaceMapMarkerCoords,
} from "./map-centroid.resolver.js";

test("resolvePlaceMapMarkerCoords: enrich не отменяет catalog polygon (отдельные роли)", () => {
  const catalog = { lat: 53.2, lon: 50.1 };
  const enriched = resolvePlaceEnrichedCentroid({
    place: { centroidLat: "53.5", centroidLon: "49.9" },
  });
  const marker = resolvePlaceMapMarkerCoords({
    place: { centroidLat: "53.5", centroidLon: "49.9" },
    geoFeatureCentroid: catalog,
  });
  assert.deepEqual(enriched, { lat: 53.5, lon: 49.9 });
  assert.deepEqual(marker, enriched);
  assert.notDeepEqual(marker, catalog);
});

test("resolvePlaceMapMarkerCoords: без enrich — fallback на centroid полигона", () => {
  const catalog = { lat: 53.2, lon: 50.1 };
  const marker = resolvePlaceMapMarkerCoords({
    place: { centroidLat: null, centroidLon: null },
    geoFeatureCentroid: catalog,
  });
  assert.deepEqual(marker, resolveCatalogGeoFeatureCentroid(catalog));
});
