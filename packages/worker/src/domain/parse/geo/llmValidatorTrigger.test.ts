import assert from "node:assert/strict";
import test from "node:test";
import type { EventCandidate } from "@radar/shared";
import { buildCandidateId, buildCandidateMergeKey } from "@radar/shared";
import type { GeoScoreMatrix } from "./geoCandidateScore.js";
import {
  isBorderlineGeoScore,
  selectLlmValidatorCandidates,
} from "./llmValidatorTrigger.js";

const BASE_MATRIX: GeoScoreMatrix = {
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
    llmValidatorConfidence: 0.3,
    llmOnly: -0.35,
    llmUngrounded: -1.05,
  },
  llmValidator: { trigger: "auto", borderlineMargin: 0.15 },
};

function candidate(name: string, score: number | undefined, start = 0): EventCandidate {
  const end = start + name.length;
  return {
    id: buildCandidateId({
      rawMessageId: "11111111-1111-1111-1111-111111111111",
      spanStart: start,
      spanEnd: end,
      anchorKind: "place",
      anchorName: name,
      authorProcessorId: "geo-processor",
    }),
    anchor: {
      kind: "place",
      name,
      regionCode: "RU-KDA",
      span: { start, end, matchedText: name },
    },
    eventType: "danger",
    extras: score === undefined ? {} : { geoScore: score },
    provenance: { eventTypeSource: "test", anchorSource: "test" },
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    status: "active",
    mergeKey: buildCandidateMergeKey({
      spanStart: start,
      spanEnd: end,
      anchorKind: "place",
      anchorName: name,
      regionCode: "RU-KDA",
    }),
    trust: 80,
  };
}

test("isBorderlineGeoScore: границы ±margin включительно", () => {
  assert.equal(isBorderlineGeoScore(0.25, 0.25, 0.15), true);
  assert.equal(isBorderlineGeoScore(0.1, 0.25, 0.15), true);
  assert.equal(isBorderlineGeoScore(0.4, 0.25, 0.15), true);
  assert.equal(isBorderlineGeoScore(0.09, 0.25, 0.15), false);
  assert.equal(isBorderlineGeoScore(0.41, 0.25, 0.15), false);
  assert.equal(isBorderlineGeoScore(undefined, 0.25, 0.15), false);
});

test("trigger=off → пустой список", () => {
  const matrix = {
    ...BASE_MATRIX,
    llmValidator: { trigger: "off" as const, borderlineMargin: 0.15 },
  };
  const selected = selectLlmValidatorCandidates(
    [candidate("Анапа", 0.2), candidate("Сочи", 1.0, 10)],
    matrix,
  );
  assert.equal(selected.length, 0);
});

test("trigger=on → все geo-кандидаты", () => {
  const matrix = {
    ...BASE_MATRIX,
    llmValidator: { trigger: "on" as const, borderlineMargin: 0.15 },
  };
  const selected = selectLlmValidatorCandidates(
    [candidate("Анапа", 0.2), candidate("Сочи", 1.0, 10)],
    matrix,
  );
  assert.equal(selected.length, 2);
});

test("trigger=auto → borderline", () => {
  const near = candidate("Северск", 0.2);
  const far = candidate("Анапа", 1.0, 20);
  const selected = selectLlmValidatorCandidates([near, far], BASE_MATRIX);
  assert.equal(selected.length, 1);
  assert.equal(selected[0]!.anchor.name, "Северск");
});

test("trigger=auto → llmOnly и llmUngrounded всегда, даже вне borderline", () => {
  const llmOnly = candidate("НовыйХутор", 1.0, 0);
  llmOnly.extras = { ...llmOnly.extras, llmOnly: true };
  const ungrounded = candidate("Выдумкино", 1.0, 30);
  ungrounded.extras = { ...ungrounded.extras, llmUngrounded: true };
  const solid = candidate("Анапа", 1.0, 60);
  const selected = selectLlmValidatorCandidates([llmOnly, ungrounded, solid], BASE_MATRIX);
  assert.equal(selected.length, 2);
  const names = selected.map((c) => c.anchor.name).sort();
  assert.deepEqual(names, ["Выдумкино", "НовыйХутор"]);
});
