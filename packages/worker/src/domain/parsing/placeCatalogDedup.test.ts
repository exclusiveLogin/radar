import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceRecord } from "@radar/shared";
import {
  findActivePlaceDuplicateGroups,
  pickCanonicalPlace,
} from "./placeCatalogDedup.js";

function base(id: string, overrides: Partial<PlaceRecord> = {}): PlaceRecord {
  return {
    id,
    regionId: "r1",
    kind: "locality",
    name: "Смоленск",
    ...overrides,
  };
}

test("pickCanonicalPlace: vendor с FIAS побеждает ingest-дубль", () => {
  const canonical = pickCanonicalPlace([
    base("bbbb", { fiasId: undefined, isTrusted: false }),
    base("aaaa", {
      lastSourceRevision: "geo-v1",
      trustState: "verified",
      isTrusted: true,
      fiasId: "fias-1",
    }),
  ]);
  assert.equal(canonical.id, "aaaa");
});

test("findActivePlaceDuplicateGroups: одна группа на region+name", () => {
  const groups = findActivePlaceDuplicateGroups([
    base("a1", { name: "Краснодар" }),
    base("a2", { name: "Краснодар" }),
    base("b1", { regionId: "r2", name: "Омск" }),
  ]);
  assert.equal(groups.size, 1);
  assert.equal(groups.get("r1\0краснодар")?.length, 2);
});
