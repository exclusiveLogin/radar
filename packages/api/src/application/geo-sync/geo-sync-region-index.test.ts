import assert from "node:assert/strict";
import test from "node:test";
import type { RegionRecord } from "@radar/shared";
import {
  alignRegionRowsWithExisting,
  buildRegionIndexForSnapshot,
  resolveRegionFromIndex,
} from "./geo-sync-region-index";

function region(partial: Partial<RegionRecord> & Pick<RegionRecord, "id" | "name">): RegionRecord {
  return {
    frontRegion: false,
    borderRegion: false,
    code: partial.iso ?? partial.name,
    ...partial,
  };
}

test("cold start: индекс из regionRows когда БД пуста", () => {
  const regionRows = [region({ id: "new-1", name: "Москва", iso: "RU-MOW" })];
  const index = buildRegionIndexForSnapshot([], regionRows);

  assert.equal(resolveRegionFromIndex(index, "RU-MOW")?.id, "new-1");
  assert.equal(resolveRegionFromIndex(index, "Москва")?.id, "new-1");
});

test("re-import: id из БД, не randomUUID из snapshot", () => {
  const existing = [region({ id: "db-1", name: "Москва", iso: "RU-MOW" })];
  const regionRows = [region({ id: "random-new", name: "Москва", iso: "RU-MOW" })];

  const aligned = alignRegionRowsWithExisting(regionRows, existing);
  assert.equal(aligned[0].id, "db-1");

  const index = buildRegionIndexForSnapshot(existing, aligned);
  assert.equal(resolveRegionFromIndex(index, "RU-MOW")?.id, "db-1");
});

test("частичный cold start: существующие + новые регионы", () => {
  const existing = [region({ id: "db-1", name: "Москва", iso: "RU-MOW" })];
  const regionRows = [
    region({ id: "random-mow", name: "Москва", iso: "RU-MOW" }),
    region({ id: "new-spb", name: "Санкт-Петербург", iso: "RU-SPE" }),
  ];
  const aligned = alignRegionRowsWithExisting(regionRows, existing);
  const index = buildRegionIndexForSnapshot(existing, aligned);

  assert.equal(resolveRegionFromIndex(index, "RU-MOW")?.id, "db-1");
  assert.equal(resolveRegionFromIndex(index, "RU-SPE")?.id, "new-spb");
});
