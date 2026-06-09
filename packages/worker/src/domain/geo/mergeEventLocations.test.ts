import assert from "node:assert/strict";
import test from "node:test";
import type { EventLocation } from "@radar/shared";
import {
  isLlmExplicitDeactivate,
  mergeEventLocations,
} from "./mergeEventLocations.js";

const regionLoc = (code: string, name: string): EventLocation => ({
  regionId: "00000000-0000-0000-0000-000000000001",
  regionCode: code,
  precision: "region",
  entityKind: "region",
  source: "db",
  placeName: name,
});

test("mergeEventLocations сохраняет prior при пустом incoming", () => {
  const prior = [regionLoc("RU-BRY", "Брянская область")];
  assert.deepEqual(mergeEventLocations(prior, []), prior);
});

test("mergeEventLocations добавляет place к prior region", () => {
  const prior = [regionLoc("RU-BRY", "Брянская область")];
  const incoming: EventLocation[] = [
    {
      regionId: "00000000-0000-0000-0000-000000000001",
      regionCode: "RU-BRY",
      precision: "city",
      entityKind: "place",
      source: "llm",
      placeName: "Клинцы",
    },
  ];
  const merged = mergeEventLocations(prior, incoming);
  assert.equal(merged.length, 2);
});

test("isLlmExplicitDeactivate true только при other + reason", () => {
  assert.equal(
    isLlmExplicitDeactivate({
      llm: { eventCategory: "other", reason: "promo channel list" },
    }),
    true,
  );
  assert.equal(
    isLlmExplicitDeactivate({ llm: { eventCategory: "other", reason: "" } }),
    false,
  );
  assert.equal(
    isLlmExplicitDeactivate({ llm: { eventCategory: "threat", reason: "x" } }),
    false,
  );
});
