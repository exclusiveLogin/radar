import assert from "node:assert/strict";
import test from "node:test";
import type { EventCandidate, GeoEnrichmentArtifact, ParseWorkspace } from "@radar/shared";
import { buildCandidateId, buildCandidateMergeKey } from "@radar/shared";
import { createEmptyParseWorkspace } from "./parseWorkspaceFactory.js";
import { runLlmValidatorProcessor } from "./llmValidatorProcessor.js";
import { computeGeoCandidateScore, type GeoScoreMatrix } from "./geo/geoCandidateScore.js";
import { isCandidateGeoScoreAcceptable } from "./geoPolicy.js";

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
    llmValidatorConfidence: 0.3,
  },
  llmValidator: { trigger: "auto", borderlineMargin: 0.15 },
};

function place(input: {
  rawMessageId: string;
  name: string;
  regionCode: string;
  start: number;
}): EventCandidate {
  const end = input.start + input.name.length;
  return {
    id: buildCandidateId({
      rawMessageId: input.rawMessageId,
      spanStart: input.start,
      spanEnd: end,
      anchorKind: "place",
      anchorName: input.name,
      authorProcessorId: "geo-processor",
    }),
    anchor: {
      kind: "place",
      name: input.name,
      regionCode: input.regionCode,
      span: { start: input.start, end, matchedText: input.name },
    },
    eventType: "danger",
    extras: {
      matchedViaAdjectiveStem: true,
      stemPoolSize: 1,
      geoScore: 0.2,
    },
    provenance: { eventTypeSource: "test", anchorSource: "test" },
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    status: "active",
    mergeKey: buildCandidateMergeKey({
      spanStart: input.start,
      spanEnd: end,
      anchorKind: "place",
      anchorName: input.name,
      regionCode: input.regionCode,
    }),
    trust: 80,
  };
}

test("processor пишет вердикт строго по candidateId (одинаковые имена не путает)", () => {
  const rawMessageId = "22222222-2222-2222-2222-222222222222";
  const a = place({ rawMessageId, name: "Северск", regionCode: "RU-TOM", start: 0 });
  const b = place({ rawMessageId, name: "Северск", regionCode: "RU-KDA", start: 40 });

  const artifact: GeoEnrichmentArtifact = {
    llmValidator: {
      schemaVersion: 1,
      verdicts: [
        {
          candidateId: a.id,
          verdict: "reject",
          confidence: 0.9,
          reason: "омоним",
        },
        {
          candidateId: b.id,
          verdict: "confirm",
          confidence: 0.8,
          reason: "район Кубани",
        },
      ],
    },
  };

  const ws: ParseWorkspace = {
    ...createEmptyParseWorkspace(rawMessageId, "Северск и Северск"),
    candidates: [a, b],
    namespaces: { geoArtifact: artifact },
  };

  runLlmValidatorProcessor(ws);

  assert.equal(a.extras.llmValidatorVerdict, "reject");
  assert.equal(a.extras.llmValidatorConfidence, 0.9);
  assert.equal(b.extras.llmValidatorVerdict, "confirm");
  assert.equal(b.extras.llmValidatorConfidence, 0.8);
});

test("regression: borderline + reject → score ниже materialize gate", () => {
  // Базовый score 0.2 (adjective+unique+minority) + reject*0.3 → 0.
  const scored = computeGeoCandidateScore(
    {
      uniqueStem: true,
      geoImprecise: false,
      matchedViaAdjectiveStem: true,
      minorityRegion: true,
      geoConflict: false,
      channelPromo: false,
      llmValidatorVerdict: "reject",
      llmValidatorConfidence: 0.9,
    },
    MATRIX,
  );
  assert.ok(scored.score < MATRIX.materializeGate.threshold);
  assert.equal(
    isCandidateGeoScoreAcceptable({
      extras: { geoScore: scored.score },
      gateEnabled: true,
      threshold: MATRIX.materializeGate.threshold,
    }),
    false,
  );
});
