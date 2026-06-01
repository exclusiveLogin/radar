import assert from "node:assert/strict";
import test from "node:test";
import { mergeContribution } from "./mergeContribution.js";
import type { ProvenanceAccumulator } from "./mergeContribution.js";
import { SOURCE_TRUST } from "../schemas/enrichment/provenance.js";

/** Вклад одного провайдера по полям накопителя (хелпер под тесты). */
function contribution(
  source: "catalog" | "llm" | "dadata" | "nominatim",
  precision: "attribute" | "region" | "locality" | "locality_with_coords",
  fields: Record<string, unknown>,
): ProvenanceAccumulator {
  const acc: ProvenanceAccumulator = {};
  for (const [key, value] of Object.entries(fields)) {
    acc[key] = { value, source, trust: SOURCE_TRUST[source], precision };
  }
  return acc;
}

const catalog = contribution("catalog", "region", {
  regionCode: "73",
  event_type: "threat",
});
const llm = contribution("llm", "attribute", {
  event_type: "impact",
  count: 3,
});
const dadata = contribution("dadata", "locality_with_coords", {
  placeName: "Ульяновск",
  lat: 54.3,
});
const nominatim = contribution("nominatim", "locality", {
  placeName: "Ulyanovsk",
  lat: 54.0,
});

function reduce(passes: ProvenanceAccumulator[]): ProvenanceAccumulator {
  return passes.reduce<ProvenanceAccumulator>(
    (acc, pass) => mergeContribution(acc, pass),
    {},
  );
}

test("mergeContribution: независим от порядка проходов", () => {
  const orderA = reduce([catalog, llm, dadata, nominatim]);
  const orderB = reduce([nominatim, dadata, llm, catalog]);
  const orderC = reduce([dadata, catalog, nominatim, llm]);
  assert.deepEqual(orderA, orderB);
  assert.deepEqual(orderA, orderC);
});

test("mergeContribution: повтор прохода — no-op (идемпотентность)", () => {
  const once = reduce([catalog, llm, dadata]);
  const twice = mergeContribution(once, dadata);
  const thrice = mergeContribution(twice, dadata);
  assert.deepEqual(once, twice);
  assert.deepEqual(twice, thrice);
});

test("mergeContribution: сильнее по precision, затем по trust", () => {
  // dadata (locality_with_coords) перебивает nominatim (locality) по placeName/lat.
  const merged = reduce([nominatim, dadata]);
  assert.equal(merged.placeName?.value, "Ульяновск");
  assert.equal(merged.lat?.value, 54.3);
  // attribute (llm) не перебивает region (catalog) по event_type — выше precision-ранг.
  const attr = reduce([llm, catalog]);
  assert.equal(attr.event_type?.value, "threat");
});

test("mergeContribution: пустое поле заполняется любым источником", () => {
  const merged = reduce([catalog, llm]);
  assert.equal(merged.count?.value, 3);
  assert.equal(merged.regionCode?.value, "73");
});
