import assert from "node:assert/strict";
import test from "node:test";
import {
  computeGeoCandidateScore,
  scaledLlmConfidenceContribution,
  type GeoScoreFactors,
  type GeoScoreMatrix,
} from "./geoCandidateScore.js";
import { parseGeoScoreMatrixYaml } from "./geoScoreMatrixRegistry.js";

const MATRIX: GeoScoreMatrix = {
  revision: "test",
  base: 1.0,
  majorityClusterMin: 3,
  materializeGate: { enabled: true, threshold: 0.25 },
  factors: {
    uniqueStem: 0.15,
    imprecise: -0.2,
    adjectiveStem: -0.45,
    minorityRegion: -0.5,
    geoConflict: -0.35,
    channelPromo: -0.7,
    llmConfidence: 0.25,
  },
};

function factors(overrides: Partial<GeoScoreFactors> = {}): GeoScoreFactors {
  return {
    uniqueStem: false,
    geoImprecise: false,
    matchedViaAdjectiveStem: false,
    minorityRegion: false,
    geoConflict: false,
    channelPromo: false,
    ...overrides,
  };
}

test("unique city: base + uniqueStem", () => {
  const { score, breakdown } = computeGeoCandidateScore(factors({ uniqueStem: true }), MATRIX);
  assert.equal(breakdown.uniqueStem, 0.15);
  assert.equal(score, 1.15);
});

test("Северск-кейс: adjective + unique + minority → ниже threshold", () => {
  const { score, breakdown } = computeGeoCandidateScore(
    factors({
      uniqueStem: true,
      matchedViaAdjectiveStem: true,
      minorityRegion: true,
    }),
    MATRIX,
  );
  assert.equal(breakdown.adjectiveStem, -0.45);
  assert.equal(breakdown.minorityRegion, -0.5);
  assert.equal(score, 0.2);
  assert.ok(score < MATRIX.materializeGate.threshold);
});

test("imprecise alone остаётся выше threshold", () => {
  const { score } = computeGeoCandidateScore(factors({ geoImprecise: true }), MATRIX);
  assert.equal(score, 0.8);
  assert.ok(score >= MATRIX.materializeGate.threshold);
});

test("channelPromo сильно штрафует", () => {
  const { score } = computeGeoCandidateScore(
    factors({ uniqueStem: true, channelPromo: true }),
    MATRIX,
  );
  assert.equal(score, 0.45);
});

test("llmConfidence scaled: 1.0 → +weight, 0 → -weight, absent → 0", () => {
  assert.equal(scaledLlmConfidenceContribution(1, 0.25), 0.25);
  assert.equal(scaledLlmConfidenceContribution(0, 0.25), -0.25);
  assert.equal(scaledLlmConfidenceContribution(0.5, 0.25), 0);
  assert.equal(scaledLlmConfidenceContribution(undefined, 0.25), 0);

  const high = computeGeoCandidateScore(factors({ llmConfidence: 1 }), MATRIX);
  assert.equal(high.breakdown.llmConfidence, 0.25);
  assert.equal(high.score, 1.25);

  const low = computeGeoCandidateScore(factors({ llmConfidence: 0 }), MATRIX);
  assert.equal(low.score, 0.75);
});

test("score clamp в [0, 2]", () => {
  const low = computeGeoCandidateScore(
    factors({
      matchedViaAdjectiveStem: true,
      minorityRegion: true,
      geoConflict: true,
      channelPromo: true,
    }),
    MATRIX,
  );
  assert.equal(low.score, 0);

  const highMatrix: GeoScoreMatrix = {
    ...MATRIX,
    base: 1.9,
    factors: { ...MATRIX.factors, uniqueStem: 0.5 },
  };
  const high = computeGeoCandidateScore(factors({ uniqueStem: true }), highMatrix);
  assert.equal(high.score, 2);
});

test("parseGeoScoreMatrixYaml читает revision/base/threshold/factors", () => {
  const yaml = `
revision: "unit-1"
base: 0.9
majorityClusterMin: 2
materializeGate:
  enabled: false
  threshold: 0.4
factors:
  uniqueStem:
    weight: 0.1
  imprecise:
    weight: -0.1
  adjectiveStem:
    weight: -0.2
  minorityRegion:
    weight: -0.3
  geoConflict:
    weight: -0.4
  channelPromo:
    weight: -0.5
  llmConfidence:
    kind: scaled
    weight: 0.2
`;
  const matrix = parseGeoScoreMatrixYaml(yaml);
  assert.equal(matrix.revision, "unit-1");
  assert.equal(matrix.base, 0.9);
  assert.equal(matrix.majorityClusterMin, 2);
  assert.equal(matrix.materializeGate.enabled, false);
  assert.equal(matrix.materializeGate.threshold, 0.4);
  assert.equal(matrix.factors.adjectiveStem, -0.2);
  assert.equal(matrix.factors.llmConfidence, 0.2);
});
