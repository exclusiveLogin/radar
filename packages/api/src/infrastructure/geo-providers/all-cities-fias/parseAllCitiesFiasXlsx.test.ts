import assert from "node:assert/strict";
import test from "node:test";
import { regionStemKey } from "../region-canonicalization";
import { resolveFiasCatalogRegionCode } from "./fiasRegionAliases";
import {
  isFiasImportableRow,
  mapFiasRowsToPlaceDrafts,
  type AllCitiesFiasRow,
} from "./parseAllCitiesFiasXlsx";

test("resolveFiasCatalogRegionCode: короткие имена FIAS → стем regions.json", () => {
  assert.equal(resolveFiasCatalogRegionCode("Татарстан"), regionStemKey("Татарстан"));
  assert.equal(
    resolveFiasCatalogRegionCode("Чувашия"),
    regionStemKey("Чувашская Республика"),
  );
  assert.equal(
    resolveFiasCatalogRegionCode("Краснодарский край"),
    regionStemKey("Краснодарский"),
  );
});

test("isFiasImportableRow: пропускает пустые и заголовок", () => {
  assert.equal(
    isFiasImportableRow({
      aoLevel: "6",
      region: "Адыгея",
      munDistrict: "Майкопский",
      cityType: "х",
      city: "Советский",
      okato: "",
      oktmo: "79622420136",
      postalCode: "",
    }),
    true,
  );
  assert.equal(
    isFiasImportableRow({
      aoLevel: "6",
      region: "",
      munDistrict: "",
      cityType: "",
      city: "Советский",
      okato: "",
      oktmo: "",
      postalCode: "",
    }),
    false,
  );
});

test("mapFiasRowsToPlaceDrafts: импортирует все уровни, дедуп по oktmo", () => {
  const rows: AllCitiesFiasRow[] = [
    {
      aoLevel: "4",
      region: "Татарстан",
      munDistrict: "Казань",
      cityType: "г",
      city: "Казань",
      okato: "92401000000",
      oktmo: "92701000",
      postalCode: "",
    },
    {
      aoLevel: "4",
      region: "Татарстан",
      munDistrict: "Казань",
      cityType: "г",
      city: "Казань",
      okato: "92401000000",
      oktmo: "92701000",
      postalCode: "",
    },
    {
      aoLevel: "6",
      region: "Кировская область",
      munDistrict: "Слободской",
      cityType: "с",
      city: "Казань",
      okato: "",
      oktmo: "33635436131",
      postalCode: "",
    },
    {
      aoLevel: "6",
      region: "Адыгея",
      munDistrict: "Майкопский",
      cityType: "х",
      city: "Советский",
      okato: "",
      oktmo: "79622420136",
      postalCode: "",
    },
  ];

  const places = mapFiasRowsToPlaceDrafts(rows);
  assert.equal(places.length, 3);
  assert.ok(places.some((place) => place.name === "Казань" && place.kind === "city"));
  assert.ok(
    places.some(
      (place) => place.name === "Казань" && place.kind === "locality" && place.oktmo === "33635436131",
    ),
  );
  assert.ok(places.some((place) => place.name === "Советский" && place.kind === "locality"));
});
