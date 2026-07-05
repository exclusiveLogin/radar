import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { PlaceScanEntry, PlaceScanHit } from "@radar/shared";
import {
  anchorsFromDefinitePlaceHits,
  filterRegionScanHits,
} from "./filterRegionScanHits.js";

function makeScanEntry(
  overrides: Partial<PlaceScanEntry> & { placeId: string; name: string; regionIso: string },
): PlaceScanEntry {
  return {
    regionId: randomUUID(),
    kind: "city",
    nameStem: overrides.name.toLowerCase(),
    ...overrides,
  };
}

function makeHit(
  entry: PlaceScanEntry,
  matchedText: string,
  imprecise = false,
): PlaceScanHit {
  return {
    entry,
    span: { start: 0, end: matchedText.length, matchedText },
    geoImprecise: imprecise,
  };
}

const PRI_REGION = makeScanEntry({
  placeId: "pri-region",
  name: "Приморский",
  nameWithType: "Приморский край",
  regionShortName: "Приморский",
  regionIso: "RU-PRI",
  kind: "region",
});

const SPB_MSG =
  "аэ.Пулково, Кронштадт, Ломоносов, Петергоф, Приморский район, Василеостровский район";

test("filterRegionScanHits: Приморский район + НП СПб — RU-PRI подавляется", () => {
  const pulkovo = makeScanEntry({
    placeId: "pulkovo",
    name: "Пулково",
    regionIso: "RU-SPE",
    kind: "locality",
  });
  const kronstadt = makeScanEntry({
    placeId: "kronstadt",
    name: "Кронштадт",
    regionIso: "RU-SPE",
    kind: "city",
  });

  const anchors = anchorsFromDefinitePlaceHits([
    makeHit(pulkovo, "Пулково"),
    makeHit(kronstadt, "Кронштадт"),
  ]);
  const filtered = filterRegionScanHits(
    SPB_MSG,
    [makeHit(PRI_REGION, "Приморский")],
    anchors,
  );

  assert.equal(filtered.length, 0);
});

test("filterRegionScanHits: явный Приморский край — RU-PRI остаётся", () => {
  const text = "Приморский край\nОпасность по БПЛА";
  const filtered = filterRegionScanHits(
    text,
    [makeHit(PRI_REGION, "Приморский край")],
    [],
  );

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.entry.regionIso, "RU-PRI");
});

test("anchorsFromDefinitePlaceHits: imprecise не попадают в якоря", () => {
  const imprecise = makeScanEntry({
    placeId: "x",
    name: "Киров",
    regionIso: "RU-KIR",
    kind: "city",
  });
  const anchors = anchorsFromDefinitePlaceHits([makeHit(imprecise, "Киров", true)]);
  assert.equal(anchors.length, 0);
});
