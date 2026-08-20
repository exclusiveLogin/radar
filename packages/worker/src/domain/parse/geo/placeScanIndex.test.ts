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

test("PlaceScanIndex: голый locality «Курумоч» без маркера/скоупа НЕ матчится (ADR-012 ужесточение)", () => {
  const index = new PlaceScanIndex(SAMARA_HOMONYM_ENTRIES);
  const hits = index.matchPlacesByPhrase("– САМАРА (Курумоч)");
  assert.equal(hits.find((h) => h.entry.name === "Курумоч"), undefined);
});

test("PlaceScanIndex: locality «Курумоч» с гео-маркером «д.» — матчится", () => {
  const index = new PlaceScanIndex(SAMARA_HOMONYM_ENTRIES);
  const hits = index.matchPlacesByPhrase("д. Курумоч");
  assert.ok(hits.some((h) => h.entry.name === "Курумоч" && h.entry.regionIso === "RU-SAM"));
});

test("PlaceScanService: аэропортный digest без области → Самара RU-SAM (city); голый Курумоч не поднимается", () => {
  const scan = new PlaceScanService(SAMARA_HOMONYM_ENTRIES, "test");
  const text = "▫️Аэропорты\n– САМАРА (Курумоч)\n– УЛЬЯНОВСК (Баратаевка)";
  const hits = scan.matchPlaces(text, {});
  const samara = hits.find((h) => h.entry.name === "Самара");
  assert.ok(samara);
  assert.equal(samara!.entry.regionIso, "RU-SAM");
  assert.equal(hits.find((h) => h.entry.name === "Курумоч"), undefined);
});

test("PlaceScanService: с regionScope голый Курумоч резолвится (scope разрешает locality)", () => {
  const scan = new PlaceScanService(SAMARA_HOMONYM_ENTRIES, "test");
  const hits = scan.matchPlaces("– САМАРА (Курумоч)", { regionScopeId: "sam-region-id" });
  assert.ok(hits.some((h) => h.entry.name === "Курумоч" && h.entry.regionIso === "RU-SAM"));
});

/**
 * Калужский кейс: районы каталога лежат как locality, имена «Кировский/Куйбышевский район»
 * повторяются в других субъектах. Явная «Калужская область» должна снимать неоднозначность.
 */
const KALUGA_DISTRICT_ENTRIES: PlaceScanEntry[] = [
  {
    placeId: "klu-region-place-id",
    regionId: "klu-region-id",
    regionIso: "RU-KLU",
    kind: "region",
    name: "Калужская",
    nameWithType: "Калужская область",
    nameStem: "калужск",
    regionShortName: "Калужская область",
  },
  {
    placeId: "klu-kirovsky-id",
    regionId: "klu-region-id",
    regionIso: "RU-KLU",
    kind: "locality",
    name: "Кировский район",
    nameStem: "кировск",
  },
  {
    placeId: "klu-kuibyshevsky-id",
    regionId: "klu-region-id",
    regionIso: "RU-KLU",
    kind: "locality",
    name: "Куйбышевский район",
    nameStem: "куйбышевск",
  },
  {
    placeId: "klu-ludinovsky-id",
    regionId: "klu-region-id",
    regionIso: "RU-KLU",
    kind: "locality",
    name: "Людиновский район",
    nameStem: "людиновск",
  },
  {
    placeId: "spe-kirovsky-id",
    regionId: "spe-region-id",
    regionIso: "RU-SPE",
    kind: "locality",
    name: "Кировский район",
    nameStem: "кировск",
  },
  {
    placeId: "sam-kuibyshevsky-id",
    regionId: "sam-region-id",
    regionIso: "RU-SAM",
    kind: "locality",
    name: "Куйбышевский район",
    nameStem: "куйбышевск",
  },
];

const KALUGA_DISTRICT_TEXT =
  "Куйбышевский район\nКировский район\nЛюдиновский район\nКалужская область\nФиксации БПЛА";

test("PlaceScanIndex: regionScope сужает пул до субъекта — омонимичные районы-locality матчатся", () => {
  const index = new PlaceScanIndex(KALUGA_DISTRICT_ENTRIES);
  const hits = index.matchPlacesByPhrase(KALUGA_DISTRICT_TEXT, {
    regionScopeId: "klu-region-id",
  });
  assert.deepEqual(
    hits.map((h) => h.entry.name),
    ["Куйбышевский район", "Кировский район", "Людиновский район"],
  );
  assert.ok(hits.every((h) => h.entry.regionIso === "RU-KLU"));
});

test("PlaceScanIndex: без regionScope районы-locality не поднимаются (ADR-012 floor)", () => {
  const index = new PlaceScanIndex(KALUGA_DISTRICT_ENTRIES);
  assert.equal(index.matchPlacesByPhrase(KALUGA_DISTRICT_TEXT).length, 0);
});

test("PlaceScanService: «Калужская область» + три района → три place-хита RU-KLU", () => {
  const scan = new PlaceScanService(KALUGA_DISTRICT_ENTRIES, "test");
  const hits = scan.matchPlaces(KALUGA_DISTRICT_TEXT, { regionScopeIso: "RU-KLU" });
  assert.deepEqual(
    hits.map((h) => h.entry.placeId),
    ["klu-kuibyshevsky-id", "klu-kirovsky-id", "klu-ludinovsky-id"],
  );
});

/** Два субъекта: уникальность place внутри объединения, не по всей стране. */
const MULTI_REGION_DISTRICT_ENTRIES: PlaceScanEntry[] = [
  ...KALUGA_DISTRICT_ENTRIES,
  {
    placeId: "tul-region-place-id",
    regionId: "tul-region-id",
    regionIso: "RU-TUL",
    kind: "region",
    name: "Тульская",
    nameWithType: "Тульская область",
    nameStem: "тульск",
    regionShortName: "Тульская область",
  },
  {
    placeId: "tul-shchekino-id",
    regionId: "tul-region-id",
    regionIso: "RU-TUL",
    kind: "locality",
    name: "Щёкинский район",
    nameStem: "щекинск",
  },
  // Омоним «Щёкинский» вне упомянутых субъектов — без multi-scope раньше мешал бы.
  {
    placeId: "other-shchekino-id",
    regionId: "other-region-id",
    regionIso: "RU-NIZ",
    kind: "locality",
    name: "Щёкинский район",
    nameStem: "щекинск",
  },
  {
    placeId: "tul-kirovsky-id",
    regionId: "tul-region-id",
    regionIso: "RU-TUL",
    kind: "locality",
    name: "Кировский район",
    nameStem: "кировск",
  },
];

test("PlaceScanService: 2 субъекта + place уникален в одном из них → берём (омонимы вне скоупа игнор)", () => {
  const scan = new PlaceScanService(MULTI_REGION_DISTRICT_ENTRIES, "test");
  const text =
    "Щёкинский район\nЛюдиновский район\nКалужская область\nТульская область\nФиксации БПЛА";
  const hits = scan.matchPlaces(text, {
    explicitRegionIsos: ["RU-KLU", "RU-TUL"],
  });
  assert.deepEqual(
    hits.map((h) => h.entry.placeId).sort(),
    ["klu-ludinovsky-id", "tul-shchekino-id"],
  );
});

test("PlaceScanService: 2 субъекта + омоним района в обоих → не берём place", () => {
  const scan = new PlaceScanService(MULTI_REGION_DISTRICT_ENTRIES, "test");
  const text = "Кировский район\nКалужская область\nТульская область\nФиксации БПЛА";
  const hits = scan.matchPlaces(text, {
    explicitRegionIsos: ["RU-KLU", "RU-TUL"],
  });
  assert.equal(hits.find((h) => h.entry.name === "Кировский район"), undefined);
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

const UDMURTIA_REGION: PlaceScanEntry[] = [
  {
    placeId: "udm-region-place-id",
    regionId: "udm-region-id",
    regionIso: "RU-UD",
    kind: "region",
    name: "Удмуртская Республика",
    nameStem: "удмурт",
    regionShortName: "Удмуртия",
  },
  {
    placeId: "junk-resp-locality-id",
    regionId: "mos-region-id",
    regionIso: "RU-MOS",
    kind: "locality",
    name: "Республика",
    nameStem: "республик",
  },
];

test("PlaceScanIndex: субъект матчится по short_name «Удмуртия» и полному имени", () => {
  const index = new PlaceScanIndex(UDMURTIA_REGION);
  assert.ok(
    index.matchRegions("Республика Удмуртия — отбой").some((h) => h.entry.regionIso === "RU-UD"),
  );
  assert.ok(
    index.matchRegions("Удмуртская Республика — отбой").some((h) => h.entry.regionIso === "RU-UD"),
  );
});

test("PlaceScanIndex: голое «Республика» не матчит junk-locality без scope (нет city+)", () => {
  const index = new PlaceScanIndex(UDMURTIA_REGION);
  const hits = index.matchPlacesByPhrase("Республика Удмуртия — отбой");
  assert.equal(hits.find((h) => h.entry.name === "Республика"), undefined);
});

const CHUVASHIA_REGION: PlaceScanEntry[] = [
  {
    placeId: "cu-region-place-id",
    regionId: "cu-region-id",
    regionIso: "RU-CU",
    kind: "region",
    name: "Чувашская Республика",
    nameWithType: "Чувашская Республика - Чувашия",
    nameStem: "чуваш",
    regionShortName: "Чувашская Республика",
  },
];

test("PlaceScanIndex: «Республика Чувашия» матчит RU-CU по суффиксу nameWithType", () => {
  const index = new PlaceScanIndex(CHUVASHIA_REGION);
  const text = "Республика Чувашия Опасность по БПЛА";
  const hits = index.matchRegions(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.entry.regionIso, "RU-CU");
  assert.equal(hits[0]!.span.matchedText, "Республика Чувашия");
});
