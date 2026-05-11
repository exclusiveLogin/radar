import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceContribution, PlaceRecord } from "@radar/shared";
import { mergePlaceContribution, monotonicTrustState } from "./placeContributionMerge.js";

function basePlace(overrides: Partial<PlaceRecord> = {}): PlaceRecord {
  return {
    id: "place-1",
    regionId: "region-1",
    kind: "locality",
    name: "Старое имя",
    ...overrides,
  };
}

function contribution(overrides: Partial<PlaceContribution> = {}): PlaceContribution {
  return {
    placeId: "place-1",
    provider: "llm",
    trustState: "unverified",
    isTrusted: false,
    trustScore: 0.55,
    fields: {},
    ...overrides,
  };
}

test("fills empty fields when incoming trust is lower", () => {
  const current = basePlace({
    trustScore: 0.95,
    nameWithType: "с. Старое имя",
    fiasId: undefined,
  });

  const { next } = mergePlaceContribution(
    current,
    contribution({
      provider: "llm",
      trustScore: 0.55,
      fields: {
        nameWithType: "с. Новое имя",
        fiasId: "fias-123",
      },
    }),
  );

  assert.equal(next.nameWithType, "с. Старое имя");
  assert.equal(next.fiasId, "fias-123");
});

test("overwrites fields when incoming trust is higher", () => {
  const current = basePlace({
    trustScore: 0.55,
    nameWithType: "с. Старое имя",
    centroidLat: 55.12,
  });

  const { next } = mergePlaceContribution(
    current,
    contribution({
      provider: "dadata",
      trustState: "verified",
      isTrusted: true,
      trustScore: 0.95,
      fields: {
        nameWithType: "г. Новое имя",
        centroidLat: 55.22,
      },
    }),
  );

  assert.equal(next.nameWithType, "г. Новое имя");
  assert.equal(next.centroidLat, 55.22);
});

test("keeps trust state monotonic", () => {
  const current = basePlace({ trustState: "verified", trustScore: 1, isTrusted: true });
  const { next } = mergePlaceContribution(
    current,
    contribution({
      trustState: "unverified",
      trustScore: 0.7,
      provider: "system",
      fields: {},
    }),
  );

  assert.equal(next.trustState, "verified");
  assert.equal(next.trustScore, 1);
  assert.equal(next.isTrusted, true);
});

test("monotonicTrustState returns strongest state", () => {
  assert.equal(monotonicTrustState("partially_verified", "unverified"), "partially_verified");
  assert.equal(monotonicTrustState("unverified", "verified"), "verified");
});

test("merges evidence providers without duplicates", () => {
  const current = basePlace({ evidenceProviders: ["dadata"] });
  const { next } = mergePlaceContribution(
    current,
    contribution({
      provider: "dadata",
      trustState: "verified",
      isTrusted: true,
      trustScore: 0.95,
    }),
  );

  assert.deepEqual(next.evidenceProviders, ["dadata"]);
});
