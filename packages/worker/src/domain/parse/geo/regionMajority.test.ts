import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceScanEntry } from "@radar/shared";
import { resolveStemToEntry } from "./placeResolvePolicy.js";
import {
  countHitsByRegionIso,
  isMinorityRegionHit,
  pickMajorityRegionIso,
} from "./regionMajority.js";

function entry(partial: Partial<PlaceScanEntry> & Pick<PlaceScanEntry, "placeId" | "name" | "nameStem" | "regionIso">): PlaceScanEntry {
  return {
    regionId: partial.regionId ?? `reg-${partial.regionIso}`,
    kind: partial.kind ?? "city",
    ...partial,
  };
}

test("resolveStemToEntry: Северский → Северск + matchedViaAdjectiveStem", () => {
  const seversk = entry({
    placeId: "place-seversk",
    name: "Северск",
    nameStem: "северск",
    regionIso: "RU-TOM",
    kind: "city",
  });
  const map = new Map<string, PlaceScanEntry[]>([["северск", [seversk]]]);

  const resolved = resolveStemToEntry(map, { label: "Северский" });
  assert.ok(resolved);
  assert.equal(resolved!.entry.name, "Северск");
  assert.equal(resolved!.matchedViaAdjectiveStem, true);
  assert.equal(resolved!.stemPoolSize, 1);
  assert.equal(resolved!.geoImprecise, false);
});

test("resolveStemToEntry: Северский район → Северск + matchedViaAdjectiveStem", () => {
  const seversk = entry({
    placeId: "place-seversk",
    name: "Северск",
    nameStem: "северск",
    regionIso: "RU-TOM",
    kind: "city",
  });
  const map = new Map<string, PlaceScanEntry[]>([["северск", [seversk]]]);

  const resolved = resolveStemToEntry(map, {
    label: "Северский район",
    kindHint: "city",
  });
  assert.ok(resolved);
  assert.equal(resolved!.entry.name, "Северск");
  assert.equal(resolved!.matchedViaAdjectiveStem, true);
});

test("resolveStemToEntry: буквальный Северск — без adjective-флага", () => {
  const seversk = entry({
    placeId: "place-seversk",
    name: "Северск",
    nameStem: "северск",
    regionIso: "RU-TOM",
  });
  const map = new Map<string, PlaceScanEntry[]>([["северск", [seversk]]]);

  const resolved = resolveStemToEntry(map, { label: "Северск" });
  assert.ok(resolved);
  assert.equal(resolved!.matchedViaAdjectiveStem, false);
  assert.equal(resolved!.stemPoolSize, 1);
});

test("resolveStemToEntry: омоним без scope → geoImprecise + stemPoolSize>1", () => {
  const a = entry({
    placeId: "a",
    name: "Киров",
    nameStem: "киров",
    regionIso: "RU-KIR",
  });
  const b = entry({
    placeId: "b",
    name: "Киров",
    nameStem: "киров",
    regionIso: "RU-CHE",
  });
  const map = new Map<string, PlaceScanEntry[]>([["киров", [a, b]]]);

  const resolved = resolveStemToEntry(map, { label: "Киров" });
  assert.ok(resolved);
  assert.equal(resolved!.geoImprecise, true);
  assert.equal(resolved!.stemPoolSize, 2);
  assert.equal(resolved!.matchedViaAdjectiveStem, false);
});

test("isMinorityRegionHit: одиночный TOM при кластере KDA", () => {
  const counts = countHitsByRegionIso([
    "RU-KDA",
    "RU-KDA",
    "RU-KDA",
    "RU-KDA",
    "RU-TOM",
  ]);
  assert.equal(pickMajorityRegionIso(counts, 3), "RU-KDA");
  assert.equal(
    isMinorityRegionHit({
      candidateRegionIso: "RU-TOM",
      regionHitCounts: counts,
      majorityClusterMin: 3,
    }),
    true,
  );
  assert.equal(
    isMinorityRegionHit({
      candidateRegionIso: "RU-KDA",
      regionHitCounts: counts,
      majorityClusterMin: 3,
    }),
    false,
  );
});

test("isMinorityRegionHit: нет кластера → не minority", () => {
  const counts = countHitsByRegionIso(["RU-TOM", "RU-KDA"]);
  assert.equal(
    isMinorityRegionHit({
      candidateRegionIso: "RU-TOM",
      regionHitCounts: counts,
      majorityClusterMin: 3,
    }),
    false,
  );
});
