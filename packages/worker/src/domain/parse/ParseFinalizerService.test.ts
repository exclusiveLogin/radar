import assert from "node:assert/strict";
import test from "node:test";
import type { EventCandidate, ParseWorkspace } from "@radar/shared";
import { planFinalize } from "./ParseFinalizerService.js";
import { buildCandidateId } from "./candidateId.js";

function candidate(input: {
  rawMessageId: string;
  anchorKind: "place" | "region";
  name: string;
  regionCode?: string;
  eventType?: string;
  start?: number;
}): EventCandidate {
  const start = input.start ?? 0;
  const end = start + input.name.length;
  return {
    id: buildCandidateId({
      rawMessageId: input.rawMessageId,
      spanStart: start,
      spanEnd: end,
      anchorKind: input.anchorKind,
      anchorName: input.name,
    }),
    anchor: {
      kind: input.anchorKind,
      name: input.name,
      regionCode: input.regionCode,
      span: { start, end, matchedText: input.name },
    },
    eventType: input.eventType ?? "danger",
    extras: {},
    provenance: { eventTypeSource: "test", anchorSource: "test" },
  };
}

function workspace(
  rawMessageId: string,
  candidates: EventCandidate[],
  groomedText = "test",
): ParseWorkspace {
  return {
    schemaVersion: 1,
    rawMessageId,
    groomedText,
    blocks: [],
    candidates,
    traitAttachments: [],
    namespaces: {},
    processorLog: [],
  };
}

test("GF-P1-03: три spawned → один candidate деактивирует двух сирот", () => {
  const rawMessageId = "11111111-1111-1111-1111-111111111111";
  const kept = candidate({ rawMessageId, anchorKind: "place", name: "Таганрог", regionCode: "ROS" });
  const plan = planFinalize({
    workspace: workspace(rawMessageId, [kept]),
    context: {
      mode: "heal",
      existingSpawnedIds: [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "cccccccc-cccc-cccc-cccc-cccccccccccc",
      ],
      candidateEventMap: {},
      orphanPolicy: "deactivate",
    },
    postedAt: "2026-06-08T20:57:57.000Z",
  });

  assert.equal(plan.materialized.length, 1);
  assert.equal(plan.orphanIds.length, 3);
});

test("invalid unknown eventType помечает prior id как invalid", () => {
  const rawMessageId = "22222222-2222-2222-2222-222222222222";
  const bad = candidate({
    rawMessageId,
    anchorKind: "region",
    name: "Область",
    regionCode: "BRY",
    eventType: "unknown",
  });
  const priorId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const plan = planFinalize({
    workspace: workspace(rawMessageId, [bad]),
    context: {
      mode: "refinalize",
      existingSpawnedIds: [priorId],
      candidateEventMap: { [bad.id]: priorId },
      orphanPolicy: "deactivate",
    },
    postedAt: "2026-06-08T20:57:57.000Z",
  });

  assert.equal(plan.materialized.length, 0);
  assert.deepEqual(plan.invalidIds, [priorId]);
});
