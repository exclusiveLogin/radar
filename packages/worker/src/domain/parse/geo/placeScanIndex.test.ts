import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceScanEntry } from "@radar/shared";
import { PlaceScanIndex } from "./placeScanIndex.js";
import { PlaceScanService } from "./placeScanService.js";
import { GF_P6_SCAN_ENTRIES } from "./testPlaceScanFixture.js";

/** Омоним «Самара»: city RU-SAM vs locality RU-IRK (кейс аэропортов без области). */
const SAMARA_HOMONYM_ENTRIES: PlaceScanEntry[] = [
  {
    placeId: "3ed0835a-ad67-49de-8491-4d6b96f1b353",
    regionId: "irk-region-id",
    regionIso: "RU-IRK",
    kind: "locality",
    name: "Самара",
    nameStem: "самара",
    centroidLat: 53.850513,
    centroidLon: 102.010262,
  },
  {
    placeId: "d656b19d-227f-4b6c-8277-4388b931f885",
    regionId: "sam-region-id",
    regionIso: "RU-SAM",
    kind: "city",
    name: "Самара",
    nameStem: "самара",
  },
  {
    placeId: "ac094a8f-28c9-4fba-8b5e-78a9746bf268",
    regionId: "sam-region-id",
    regionIso: "RU-SAM",
    kind: "locality",
    name: "Курумоч",
    nameStem: "курумоч",
  },
];

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

test("PlaceScanIndex: region short_name phrase match", () => {
  const index = new PlaceScanIndex(GF_P6_SCAN_ENTRIES);
  const hits = index.matchRegions("Таганрог\nРостовская\nОпасность");
  assert.ok(hits.some((h) => h.entry.regionIso === "RU-ROS"));
});

test("PlaceScanIndex: без области — locality «Самара» не матчится, только city RU-SAM", () => {
  const index = new PlaceScanIndex(SAMARA_HOMONYM_ENTRIES);
  const hits = index.matchPlacesByPhrase("– САМАРА (Курумоч)");
  const samara = hits.find((h) => h.entry.name === "Самара");
  assert.ok(samara);
  assert.equal(samara!.entry.regionIso, "RU-SAM");
  assert.equal(samara!.entry.kind, "city");
  assert.equal(samara!.geoImprecise, false);
});

test("PlaceScanIndex: уникальный locality «Курумоч» матчится без области", () => {
  const index = new PlaceScanIndex(SAMARA_HOMONYM_ENTRIES);
  const hits = index.matchPlacesByPhrase("– САМАРА (Курумоч)");
  assert.ok(hits.some((h) => h.entry.name === "Курумоч" && h.entry.regionIso === "RU-SAM"));
});

test("PlaceScanService: аэропортный digest без области → Самара RU-SAM + Курумоч", () => {
  const scan = new PlaceScanService(SAMARA_HOMONYM_ENTRIES, "test");
  const text = "▫️Аэропорты\n– САМАРА (Курумоч)\n– УЛЬЯНОВСК (Баратаевка)";
  const hits = scan.matchPlaces(text, {});
  const samara = hits.find((h) => h.entry.name === "Самара");
  assert.ok(samara);
  assert.equal(samara!.entry.regionIso, "RU-SAM");
  assert.ok(hits.some((h) => h.entry.name === "Курумоч"));
});

const ILI_LOCALITY: PlaceScanEntry[] = [
  {
    placeId: "ili-locality-id",
    regionId: "irk-region-id",
    regionIso: "RU-IRK",
    kind: "locality",
    name: "Или",
    nameStem: "или",
    centroidLat: 54.0,
    centroidLon: 103.0,
  },
];

test("PlaceScanIndex: союз «или» не матчит locality Или (RU-IRK)", () => {
  const index = new PlaceScanIndex(ILI_LOCALITY);
  const text = "Старый Оскол или Нижнедевицкий район, Воронежской области.";
  const hits = index.matchPlacesByPhrase(text);
  assert.equal(hits.length, 0);
});

test("PlaceScanService: союз «или» в оперативном тексте — без false positive", () => {
  const scan = new PlaceScanService(ILI_LOCALITY, "test");
  const text = "пролёт в сторону Старый Оскол или Нижнедевицкий район";
  const hits = scan.matchPlaces(text, {});
  assert.equal(hits.length, 0);
});

const MERY_LOCALITY: PlaceScanEntry[] = [
  {
    placeId: "mery-locality-id",
    regionId: "mos-region-id",
    regionIso: "RU-MOS",
    kind: "locality",
    name: "Меры",
    nameStem: "меры",
    centroidLat: 55.81,
    centroidLon: 37.62,
  },
];

test("PlaceScanIndex: «Меры безопасности» не матчит locality Меры (RU-MOS)", () => {
  const index = new PlaceScanIndex(MERY_LOCALITY);
  const text = "Щекинский район\nТульская область\nРабота ПВО по БПЛА\nМеры безопасности";
  const hits = index.matchPlacesByPhrase(text);
  assert.equal(hits.length, 0);
});
