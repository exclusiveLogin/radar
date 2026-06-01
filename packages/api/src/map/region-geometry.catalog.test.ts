import assert from "node:assert/strict";
import test from "node:test";
import { RegionGeometryCatalog } from "./region-geometry.catalog.js";

test("OSM-подписи республик и областей → разные ISO (без fuzzy match)", () => {
  const catalog = RegionGeometryCatalog.getInstance();
  catalog.bindRegions([]);

  assert.equal(
    catalog.resolveIsoForTest("Республика Ингушетия"),
    "RU-IN",
  );
  assert.equal(
    catalog.resolveIsoForTest("Республика Саха (Якутия)"),
    "RU-SA",
  );
  assert.equal(catalog.resolveIsoForTest("Республика Коми"), "RU-KO");
  assert.equal(catalog.resolveIsoForTest("Белгородская обл."), "RU-BEL");

  assert.notEqual(
    catalog.resolveIsoForTest("Республика Саха (Якутия)"),
    catalog.resolveIsoForTest("Республика Коми"),
  );

  RegionGeometryCatalog.resetForTests();
});

test("buildLayer: у каждого контура свой regionCode", () => {
  const catalog = RegionGeometryCatalog.getInstance();
  catalog.bindRegions([]);
  const layer = catalog.buildLayer(new Map([["RU-SA", "red"]]), {
    includeGrey: true,
  });
  const byLabel = new Map(
    layer.features.map((f) => [
      String(f.properties.label),
      String(f.properties.regionCode),
    ]),
  );

  assert.equal(byLabel.get("Республика Саха (Якутия)"), "RU-SA");
  assert.equal(byLabel.get("Республика Ингушетия"), "RU-IN");

  const saha = layer.features.find(
    (f) => f.properties.regionCode === "RU-SA",
  );
  const ing = layer.features.find(
    (f) => f.properties.regionCode === "RU-IN",
  );
  assert.ok(saha);
  assert.ok(ing);
  assert.notEqual(saha?.id, ing?.id);

  RegionGeometryCatalog.resetForTests();
});
