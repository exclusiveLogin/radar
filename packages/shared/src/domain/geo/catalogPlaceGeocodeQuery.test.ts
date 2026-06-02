import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCatalogPlaceGeocodeQuery,
  formatFederalSubjectLabel,
  normalizeFederalSubjectDisplay,
} from "./catalogPlaceGeocodeQuery.js";

test("formatFederalSubjectLabel: nameWithType с типом", () => {
  assert.equal(
    formatFederalSubjectLabel({
      name: "Белгородская",
      nameWithType: "Белгородская область",
    }),
    "Белгородская область",
  );
});

test("formatFederalSubjectLabel: короткое name → область", () => {
  assert.equal(
    formatFederalSubjectLabel({ name: "Белгородская" }),
    "Белгородская область",
  );
});

test("normalizeFederalSubjectDisplay: FIAS prefix", () => {
  assert.equal(normalizeFederalSubjectDisplay("обл Белгородская"), "Белгородская область");
});

test("buildCatalogPlaceGeocodeQuery: район + субъект + Россия", () => {
  assert.equal(
    buildCatalogPlaceGeocodeQuery({
      placeName: "Корочанский район",
      region: { name: "Белгородская", nameWithType: "Белгородская область" },
    }),
    "Корочанский район, Белгородская область, Россия",
  );
});

test("buildCatalogPlaceGeocodeQuery: НП + район + субъект", () => {
  assert.equal(
    buildCatalogPlaceGeocodeQuery({
      placeName: "Ивановка",
      placeNameWithType: "с. Ивановка",
      parentPlaceName: "Корочанский район",
      region: { name: "Белгородская область" },
    }),
    "с. Ивановка, Корочанский район, Белгородская область, Россия",
  );
});
