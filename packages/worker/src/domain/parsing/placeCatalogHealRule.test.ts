import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceRecord } from "@radar/shared";
import {
  isPlaceCatalogHealCandidate,
  isVendorCatalogPlace,
} from "./placeCatalogHealRule.js";

function basePlace(overrides: Partial<PlaceRecord> = {}): PlaceRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    regionId: "22222222-2222-4222-8222-222222222222",
    kind: "locality",
    name: "Иркутск",
    ...overrides,
  };
}

test("vendor catalog place не кандидат", () => {
  const place = basePlace({
    lastSourceRevision: "geo-v1",
    trustState: "verified",
    isTrusted: true,
    fiasId: "fias-1",
  });
  assert.equal(isVendorCatalogPlace(place), true);
  assert.equal(isPlaceCatalogHealCandidate(place), false);
});

test("garbage name — кандидат", () => {
  const place = basePlace({ name: "Иркутск 24/7" });
  assert.equal(isPlaceCatalogHealCandidate(place), true);
});

test("kind=region — не кандидат", () => {
  const place = basePlace({ kind: "region", name: "Нижегородская обл" });
  assert.equal(isPlaceCatalogHealCandidate(place), false);
});

test("scope=all включает verified ingest без revision", () => {
  const place = basePlace({
    trustState: "verified",
    isTrusted: true,
    fiasId: "fias-x",
  });
  assert.equal(isPlaceCatalogHealCandidate(place, "candidates"), false);
  assert.equal(isPlaceCatalogHealCandidate(place, "all"), true);
});
