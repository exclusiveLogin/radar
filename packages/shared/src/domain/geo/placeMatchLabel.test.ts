import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPlaceMatchStems,
  normalizePlaceMatchLabel,
  placeStemCore,
} from "./placeMatchLabel";
import { placeStem } from "./placeStem";

test("normalizePlaceMatchLabel: ГО и городской округ", () => {
  assert.equal(normalizePlaceMatchLabel("ГО Домодедово"), "Домодедово");
  assert.equal(
    normalizePlaceMatchLabel("Городской Округ Домодедово"),
    "Домодедово",
  );
  assert.equal(
    normalizePlaceMatchLabel("Наро-фоминский Городской Округ"),
    "Наро-фоминский",
  );
});

test("placeStem: ГО Домодедово совпадает с FIAS-городом", () => {
  assert.equal(placeStem("ГО Домодедово"), placeStem("Домодедово"));
  assert.equal(placeStem("ГО Домодедово"), "домодедово");
});

test("collectPlaceMatchStems: прилагательный городской округ → город", () => {
  const stems = collectPlaceMatchStems("Наро-фоминский Городской Округ");
  assert.ok(stems.includes("нарофоминск"));
  assert.equal(placeStemCore("Наро-Фоминск"), "нарофоминск");
});
