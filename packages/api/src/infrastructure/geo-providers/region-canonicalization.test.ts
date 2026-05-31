import assert from "node:assert/strict";
import test from "node:test";
import type { RegionDraft } from "@radar/shared";
import { canonicalizeRegions, regionStemKey } from "./region-canonicalization";

test("regionStemKey: варианты типа субъекта сводятся к одному стему", () => {
  const stem = regionStemKey("Воронежская");
  assert.equal(regionStemKey("Воронежская обл."), stem);
  assert.equal(regionStemKey("Воронежская область"), stem);
  assert.equal(regionStemKey("воронежская обл"), stem);
});

test("regionStemKey: республики (Респ/Республика) сводятся к имени", () => {
  const stem = regionStemKey("Адыгея");
  assert.equal(regionStemKey("Респ Адыгея"), stem);
  assert.equal(regionStemKey("Республика Адыгея"), stem);
});

test("regionStemKey: скобочный дубль из geojson схлопывается", () => {
  // «Республика Адыгея (Адыгея)» → токены [адыгея, адыгея] → дедуп → "адыгея"
  assert.equal(regionStemKey("Республика Адыгея (Адыгея)"), regionStemKey("Адыгея"));
  assert.equal(regionStemKey("Республика Татарстан (Татарстан)"), regionStemKey("Татарстан"));
});

test("regionStemKey: ручные алиасы (Кузбасс, Чувашия) ведут к канону hflabs", () => {
  // geojson «Кемеровская область» → канон «Кемеровская область - Кузбасс»
  assert.equal(
    regionStemKey("Кемеровская область"),
    regionStemKey("Кемеровская область - Кузбасс"),
  );
  // geojson «Чувашская Республика - Чувашия» → канон «Чувашская Республика»
  assert.equal(
    regionStemKey("Чувашская Республика - Чувашия"),
    regionStemKey("Чувашская Республика"),
  );
});

test("canonicalizeRegions: hflabs(identity) + geojson(geometry) → один канон-регион", () => {
  const drafts: RegionDraft[] = [
    { name: "Воронежская", nameWithType: "Воронежская обл", iso: "RU-VOR", fiasId: "fias-vor", frontRegion: false, borderRegion: false },
    { name: "Воронежская область", geometryArtifactKey: "geo/osm/vor.geojson", centroidLat: 51.6, centroidLon: 39.2, frontRegion: false, borderRegion: false },
    { name: "Воронежская обл.", geometryArtifactKey: "geo/rnek/vor.geojson", frontRegion: false, borderRegion: false },
  ];

  const { regions, dropped } = canonicalizeRegions(drafts);

  assert.equal(regions.length, 1);
  assert.equal(dropped.length, 0);
  const [region] = regions;
  assert.equal(region.iso, "RU-VOR");
  assert.equal(region.fiasId, "fias-vor");
  // геометрия долита из geojson-драфта
  assert.equal(region.geometryArtifactKey, "geo/osm/vor.geojson");
  assert.equal(region.centroidLat, 51.6);
});

test("canonicalizeRegions: группа без настоящего ISO отбрасывается (не фантом)", () => {
  const drafts: RegionDraft[] = [
    { name: "Нечтовская область", geometryArtifactKey: "geo/x.geojson", frontRegion: false, borderRegion: false },
  ];

  const { regions, dropped } = canonicalizeRegions(drafts);

  assert.equal(regions.length, 0);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].name, "Нечтовская область");
});

test("canonicalizeRegions: разные субъекты не склеиваются", () => {
  const drafts: RegionDraft[] = [
    { name: "Алтай", nameWithType: "Респ Алтай", iso: "RU-AL", frontRegion: false, borderRegion: false },
    { name: "Алтайский", nameWithType: "Алтайский край", iso: "RU-ALT", frontRegion: false, borderRegion: false },
  ];

  const { regions } = canonicalizeRegions(drafts);

  assert.equal(regions.length, 2);
  const isos = regions.map((r) => r.iso).sort();
  assert.deepEqual(isos, ["RU-AL", "RU-ALT"]);
});
