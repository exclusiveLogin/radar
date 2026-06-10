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

test("OSM Russia_regions: сокращения АО / Республика → ISO", () => {
  const catalog = RegionGeometryCatalog.getInstance();
  catalog.bindRegions([]);

  const cases: Array<[string, string]> = [
    ["Еврейская АО", "RU-YEV"],
    ["Кабардино-Балкарская Республика", "RU-KB"],
    ["Карачаево-Черкесская Республика", "RU-KC"],
    ["Ненецкий АО", "RU-NEN"],
    ["Удмуртская Республика", "RU-UD"],
    ["Ханты-Мансийский АО - Югра", "RU-KHM"],
    ["Чеченская Республика", "RU-CE"],
    ["Чукотский АО", "RU-CHU"],
    ["Ямало-Ненецкий АО", "RU-YAN"],
  ];

  for (const [label, iso] of cases) {
    assert.equal(
      catalog.resolveIsoForTest(label),
      iso,
      `label=${label}`,
    );
  }

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

test("Крым/Севастополь и Донбасс: контуры в buildLayer", () => {
  const catalog = RegionGeometryCatalog.getInstance();
  catalog.bindRegions([
    { iso: "RU-CR", name: "Республика Крым", nameWithType: "Республика Крым" },
    { iso: "RU-DON", name: "Донецкая народная Республика" },
  ]);

  const layer = catalog.buildLayer(
    new Map([
      ["RU-CR", "red"],
      ["RU-DON", "yellow"],
    ]),
    { includeGrey: true },
  );
  const codes = new Set(
    layer.features.map((f) => String(f.properties.regionCode)),
  );

  assert.ok(codes.has("RU-CR"), "Крым из Russia_regions.geojson");
  assert.ok(codes.has("RU-SEV"), "Севастополь из Russia_regions.geojson");
  assert.ok(codes.has("RU-DON"), "ДНР из supplemental/front-regions.geojson");
  assert.ok(codes.has("RU-LUG"));
  assert.ok(codes.has("RU-ZP"));
  assert.ok(codes.has("RU-KHE"));

  RegionGeometryCatalog.resetForTests();
});
