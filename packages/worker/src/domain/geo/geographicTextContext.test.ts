import assert from "node:assert/strict";
import test from "node:test";
import { KnownLocalityCatalog } from "../../infrastructure/geo-catalog/knownLocalityCatalog.js";
import {
  filterRegionsByTextContext,
  findLocalityAnchorsInText,
  inferPreferredRegionCode,
  isBlockedRegionCatalogLookup,
  isExplicitFederalSubjectAlias,
  regionHasExplicitMentionInText,
  resolveEnricherGeocode,
  shouldSuppressFederalSubjectMatch,
} from "./geographicTextContext.js";

const ANCHORS = KnownLocalityCatalog.loadFromDictionaries().list();

const AKHTAR_MSG =
  "Приморско-Ахтарский район\nОпасность по БПЛА\nКраснодарский край";

const MARIUPOL_MSG =
  "Приморский, ЖД Вокзал Мариуполь\nТревога по БПЛА";

const PRI_EXPLICIT = "Приморский край\nОпасность по БПЛА";

test("isExplicitFederalSubjectAlias", () => {
  assert.equal(isExplicitFederalSubjectAlias("краснодарский край"), true);
  assert.equal(isExplicitFederalSubjectAlias("приморский"), false);
});

test("якорь Мариуполь в тексте", () => {
  const anchors = findLocalityAnchorsInText(MARIUPOL_MSG, ANCHORS);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0]?.regionCode, "RU-DON");
});

test("PRI подавляется при якоре Мариуполь", () => {
  const pri = {
    code: "25",
    name: "Приморский край",
    aliases: ["приморский", "приморский край"],
  };
  const anchors = findLocalityAnchorsInText(MARIUPOL_MSG, ANCHORS);
  assert.equal(shouldSuppressFederalSubjectMatch(MARIUPOL_MSG, pri, anchors), true);
});

test("filter: Ахтар + явный Краснодар → без PRI", () => {
  const anchors = findLocalityAnchorsInText(AKHTAR_MSG, ANCHORS);
  const out = filterRegionsByTextContext(
    [
      { code: "25", name: "Приморский край", aliases: ["приморский"] },
      { code: "23", name: "Краснодарский край", aliases: ["краснодарский", "краснодарский край"] },
    ],
    AKHTAR_MSG,
    anchors,
  );
  assert.ok(!out.some((r) => r.code === "25"));
  assert.ok(out.some((r) => r.code === "23"));
});

test("filter: Мариуполь → предпочтение RU-DON", () => {
  const anchors = findLocalityAnchorsInText(MARIUPOL_MSG, ANCHORS);
  const out = filterRegionsByTextContext(
    [{ code: "25", name: "Приморский край", aliases: ["приморский"] }],
    MARIUPOL_MSG,
    anchors,
  );
  assert.ok(!out.some((r) => r.code === "25"));
  assert.ok(out.some((r) => r.code === "RU-DON"));
  assert.equal(inferPreferredRegionCode(MARIUPOL_MSG, anchors), "RU-DON");
});

test("явный Приморский край не подавляется", () => {
  const pri = {
    code: "25",
    name: "Приморский край",
    aliases: ["приморский край"],
  };
  assert.equal(regionHasExplicitMentionInText(PRI_EXPLICIT, pri), true);
  const anchors = findLocalityAnchorsInText(PRI_EXPLICIT, ANCHORS);
  assert.equal(shouldSuppressFederalSubjectMatch(PRI_EXPLICIT, pri, anchors), false);
});

test("isBlockedRegionCatalogLookup: Приморский vs край при якоре", () => {
  const anchors = findLocalityAnchorsInText(MARIUPOL_MSG, ANCHORS);
  assert.equal(
    isBlockedRegionCatalogLookup(
      "Приморский",
      "Приморский край",
      "25",
      anchors,
    ),
    true,
  );
});

const NN_MSG = "‼️Аэропорт НИЖНИЙ НОВГОРОД (Чкалов)\nУгроза БПЛА";

test("якорь Нижний Новгород подавляет ложную Новгородскую (53→52)", () => {
  const anchors = findLocalityAnchorsInText(NN_MSG, ANCHORS);
  assert.equal(anchors[0]?.regionCode, "52");

  // catalog по adjective-stem «новгород» ложно цепляет Новгородскую (53)
  const novgorodskaya = {
    code: "53",
    name: "Новгородская область",
    aliases: ["новгородская", "новгородская область", "новгород"],
  };
  assert.equal(
    shouldSuppressFederalSubjectMatch(NN_MSG, novgorodskaya, anchors),
    true,
  );
  assert.equal(inferPreferredRegionCode(NN_MSG, anchors), "52");
});

const NIKOLAEVSKY_ULY_MSG =
  "Николаевский район\nУльяновская область\nФиксация БПЛА";

test("resolveEnricherGeocode: омонимичный район + явная область", () => {
  const out = resolveEnricherGeocode(
    NIKOLAEVSKY_ULY_MSG,
    [{ name: "Николаевский район", kind: "district" }],
    [{ code: "73", name: "Ульяновская область", aliases: ["ульяновская", "ульяновская область"] }],
  );
  assert.equal(
    out.query,
    "Николаевский район, Ульяновская область, Россия",
  );
  assert.equal(out.bindPlaceName, "Николаевский район");
});
