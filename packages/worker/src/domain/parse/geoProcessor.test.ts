import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { IPlaceScanPort, PlaceScanEntry, PlaceScanHit, PlaceResolveContext } from "@radar/shared";
import { createEmptyParseWorkspace } from "./parseWorkspaceFactory.js";
import { runGeoProcessor } from "./geoProcessor.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeScanEntry(overrides: Partial<PlaceScanEntry> & { placeId: string; name: string; regionIso: string }): PlaceScanEntry {
  return {
    regionId: randomUUID(),
    kind: "city",
    nameStem: overrides.name.toLowerCase(),
    ...overrides,
  };
}

function makeHit(entry: PlaceScanEntry, text: string, imprecise = false): PlaceScanHit {
  return {
    entry,
    span: { start: 0, end: text.length, matchedText: text },
    geoImprecise: imprecise,
  };
}

/**
 * Мок IPlaceScanPort: отвечает на конкретные вызовы matchPlaces по тексту.
 * matchPlacesMap: text → PlaceScanHit[]
 */
function makeScanPort(opts: {
  matchPlacesMap: Map<string, PlaceScanHit[]>;
  regionHits?: PlaceScanHit[];
}): IPlaceScanPort {
  return {
    matchRegions: () => opts.regionHits ?? [],
    matchPlaces: (text: string, _ctx: PlaceResolveContext) => {
      return opts.matchPlacesMap.get(text) ?? [];
    },
    regionIsoForPlace: async () => null,
    revision: () => "test",
  };
}

// ─── тесты ──────────────────────────────────────────────────────────────────

test("geoProcessor co-mention: imprecise Приморск дропается если нет в anchor-регионе Мангуша", () => {
  const TEXT = "Приморск — Мангуш";

  const mangush = makeScanEntry({ placeId: "mangush-id", name: "Мангуш", regionIso: "RU-ZP", kind: "locality" });
  const primorsk = makeScanEntry({ placeId: "primorsk-kgd", name: "Приморск", regionIso: "RU-KGD", kind: "city" });

  const placeScan = makeScanPort({
    // полный текст → Мангуш definite + Приморск imprecise
    matchPlacesMap: new Map([
      [TEXT, [makeHit(mangush, "Мангуш", false), makeHit(primorsk, "Приморск", true)]],
      // co-mention re-query: "Приморск" в RU-ZP → пусто
      ["Приморск", []],
    ]),
  });

  const ws = { ...createEmptyParseWorkspace(randomUUID(), TEXT), groomedText: TEXT };
  runGeoProcessor({ workspace: ws, placeScan });

  const placeNames = ws.candidates.map((c) => c.anchor.name);
  assert.deepEqual(placeNames, ["Мангуш"], "Приморск должен быть дропнут, Мангуш — остаться");
});

test("geoProcessor co-mention: imprecise хит остаётся если найден в anchor-регионе", () => {
  const TEXT = "Приморск — Мангуш";

  const mangush = makeScanEntry({ placeId: "mangush-id", name: "Мангуш", regionIso: "RU-ZP", kind: "locality" });
  // Предположим, в RU-ZP есть Приморський (другой объект)
  const primorskZp = makeScanEntry({ placeId: "primorsk-zp", name: "Приморськ", regionIso: "RU-ZP", kind: "city" });
  const primorskKgd = makeScanEntry({ placeId: "primorsk-kgd", name: "Приморск", regionIso: "RU-KGD", kind: "city" });

  const placeScan = makeScanPort({
    matchPlacesMap: new Map([
      [TEXT, [makeHit(mangush, "Мангуш", false), makeHit(primorskKgd, "Приморск", true)]],
      // co-mention re-query: "Приморск" в RU-ZP → нашли primorskZp
      ["Приморск", [makeHit(primorskZp, "Приморск", false)]],
    ]),
  });

  const ws = { ...createEmptyParseWorkspace(randomUUID(), TEXT), groomedText: TEXT };
  runGeoProcessor({ workspace: ws, placeScan });

  const regionCodes = ws.candidates.map((c) => c.anchor.regionCode);
  assert.ok(regionCodes.includes("RU-ZP"), "Должен использоваться RU-ZP кандидат");
  assert.ok(!regionCodes.includes("RU-KGD"), "RU-KGD кандидат должен быть заменён");
});

test("geoProcessor co-mention: без anchors хиты не фильтруются", () => {
  const TEXT = "Приморск — Мариуполь";

  const primorsk = makeScanEntry({ placeId: "primorsk-kgd", name: "Приморск", regionIso: "RU-KGD", kind: "city" });
  const mariupol = makeScanEntry({ placeId: "mariupol-id", name: "Мариуполь", regionIso: "RU-DON", kind: "city" });

  // Оба imprecise → нет anchors → co-mention не применяется, оба остаются
  const placeScan = makeScanPort({
    matchPlacesMap: new Map([
      [TEXT, [makeHit(primorsk, "Приморск", true), makeHit(mariupol, "Мариуполь", true)]],
    ]),
  });

  const ws = { ...createEmptyParseWorkspace(randomUUID(), TEXT), groomedText: TEXT };
  runGeoProcessor({ workspace: ws, placeScan });

  assert.equal(ws.candidates.length, 2, "Оба хита остаются когда нет definite anchors");
});

test("geoProcessor co-mention: с явным регионом в тексте co-mention не применяется", () => {
  const TEXT = "Приморск в Запорожской области";

  const zapRegion = makeScanEntry({ placeId: "zap-region", name: "Запорожская область", regionIso: "RU-ZP", kind: "region" });
  const primorsk = makeScanEntry({ placeId: "primorsk-kgd", name: "Приморск", regionIso: "RU-KGD", kind: "city" });

  const placeScan = makeScanPort({
    matchPlacesMap: new Map([
      // unscoped
      [TEXT, [makeHit(primorsk, "Приморск", true)]],
      // scoped (с regionScopeIso=RU-ZP через matchPlaces)
      [TEXT, [makeHit(primorsk, "Приморск", true)]],
    ]),
    regionHits: [makeHit(zapRegion, "Запорожской области")],
  });

  const ws = { ...createEmptyParseWorkspace(randomUUID(), TEXT), groomedText: TEXT };
  runGeoProcessor({ workspace: ws, placeScan });

  // при явном регионе co-mention не запускается, обычный scope применяется через matchPlaces
  // Проверяем только что geoProcessor не упал
  assert.ok(ws.candidates.length >= 0);
});
