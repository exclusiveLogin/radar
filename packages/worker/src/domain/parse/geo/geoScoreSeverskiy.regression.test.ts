import assert from "node:assert/strict";
import test from "node:test";
import type { EventCandidate, ParseWorkspace } from "@radar/shared";
import { buildCandidateId, buildCandidateMergeKey } from "@radar/shared";
import { planFinalize } from "../ParseFinalizerService.js";
import { createEmptyParseWorkspace } from "../parseWorkspaceFactory.js";
import { runGeoCandidateScoring } from "./geoCandidateScoring.js";
import type { GeoScoreMatrix } from "./geoCandidateScore.js";

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
    llmOnly: -0.35,
    llmUngrounded: -1.05,
  },
  llmValidator: { trigger: "auto", borderlineMargin: 0.15 },
};

function placeCandidate(input: {
  rawMessageId: string;
  name: string;
  regionCode: string;
  start: number;
  extras?: Record<string, unknown>;
}): EventCandidate {
  const end = input.start + input.name.length;
  const anchor = {
    kind: "place" as const,
    name: input.name,
    regionCode: input.regionCode,
    span: { start: input.start, end, matchedText: input.name },
  };
  return {
    id: buildCandidateId({
      rawMessageId: input.rawMessageId,
      spanStart: input.start,
      spanEnd: end,
      anchorKind: "place",
      anchorName: input.name,
      authorProcessorId: "geo-processor",
    }),
    anchor,
    eventType: "danger",
    extras: input.extras ?? {},
    provenance: { eventTypeSource: "test", anchorSource: "geo-processor" },
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

test("regression: Кубань-кластер + Северск(adjective) → RU-TOM не materialize", () => {
  const rawMessageId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const text =
    "БЕСПИЛОТНАЯ ОПАСНОСТЬ: Анапа, Новороссийск, Геленджик, Сочи, Северский районы";
  const ws: ParseWorkspace = {
    ...createEmptyParseWorkspace(rawMessageId, text),
    candidates: [
      placeCandidate({ rawMessageId, name: "Анапа", regionCode: "RU-KDA", start: 0 }),
      placeCandidate({ rawMessageId, name: "Новороссийск", regionCode: "RU-KDA", start: 10 }),
      placeCandidate({ rawMessageId, name: "Геленджик", regionCode: "RU-KDA", start: 30 }),
      placeCandidate({ rawMessageId, name: "Сочи", regionCode: "RU-KDA", start: 50 }),
      placeCandidate({
        rawMessageId,
        name: "Северск",
        regionCode: "RU-TOM",
        start: 60,
        extras: {
          matchedViaAdjectiveStem: true,
          stemPoolSize: 1,
        },
      }),
    ],
  };

  runGeoCandidateScoring(ws, MATRIX);

  const seversk = ws.candidates.find((c) => c.anchor.name === "Северск")!;
  const anapa = ws.candidates.find((c) => c.anchor.name === "Анапа")!;
  assert.ok(typeof seversk.extras.geoScore === "number");
  assert.ok((seversk.extras.geoScore as number) < 0.25);
  assert.ok((anapa.extras.geoScore as number) >= 0.25);

  const plan = planFinalize({
    workspace: ws,
    context: {
      mode: "initial",
      existingSpawnedIds: [],
      candidateEventMap: {},
      orphanPolicy: "deactivate",
    },
    postedAt: "2026-08-03T16:21:12.000Z",
  });

  const names = plan.materialized.map((m) => {
    const anchor = (m.parsedEvent.extras as { anchor?: { name?: string; regionCode?: string } } | undefined)
      ?.anchor;
    return anchor?.name ?? "";
  });
  const regionCodes = plan.materialized.map((m) => {
    const anchor = (m.parsedEvent.extras as { anchor?: { regionCode?: string } } | undefined)?.anchor;
    return anchor?.regionCode ?? "";
  });

  assert.ok(!names.includes("Северск"), `Северск не должен materialize: ${names.join(",")}`);
  assert.ok(!regionCodes.includes("RU-TOM"));
  assert.ok(names.includes("Анапа"));
  assert.ok(names.includes("Сочи"));
  assert.equal(plan.materialized.length, 4);
});
