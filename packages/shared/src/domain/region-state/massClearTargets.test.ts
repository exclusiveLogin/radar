import assert from "node:assert/strict";
import test from "node:test";
import {
  isMassClearTextEligible,
  normalizeClearHaystack,
  resolveMassClearTargets,
  type MassClearRegionRef,
} from "./massClearTargets";

const regions: MassClearRegionRef[] = [
  {
    id: "r-yar",
    iso: "RU-YAR",
    name: "Ярославская область",
    nameWithType: "Ярославская обл.",
    shortName: "Ярославская",
  },
  {
    id: "r-mos",
    iso: "RU-MOS",
    name: "Московская область",
    nameWithType: null,
    shortName: null,
  },
];

test("resolveMassClearTargets: групповой отбой по тексту", () => {
  const hits = resolveMassClearTargets(
    "Отбой: Ярославская область, Московская область",
    regions,
  );
  assert.equal(hits.length, 2);
  assert.deepEqual(
    hits.map((h) => h.regionCode).sort(),
    ["RU-MOS", "RU-YAR"],
  );
});

test("resolveMassClearTargets: без отбой/двоеточия — пусто", () => {
  assert.deepEqual(resolveMassClearTargets("тревога в Ярославской", regions), []);
});

test("normalizeClearHaystack: ё и пунктуация", () => {
  assert.equal(normalizeClearHaystack("Ёлка!"), "елка");
});

test("isMassClearTextEligible", () => {
  assert.equal(isMassClearTextEligible("cleared", 1), true);
  assert.equal(isMassClearTextEligible("cleared", 2), false);
  assert.equal(isMassClearTextEligible("fixation", 0), false);
});
