import assert from "node:assert/strict";
import test from "node:test";
import type { EventCandidate, ParseWorkspace } from "@radar/shared";
import { buildCandidateId, buildCandidateMergeKey } from "@radar/shared";
import { planFinalize } from "./ParseFinalizerService.js";
import { appendCandidate } from "./parseProcessorContract.js";
import { createEmptyParseWorkspace } from "./parseWorkspaceFactory.js";

function v2Candidate(input: {
  rawMessageId: string;
  authorProcessorId: string;
  authorEnricherId: "catalog" | "llm";
  trust: number;
  anchorKind: "place" | "region";
  name: string;
  regionCode?: string;
  eventType?: string;
  start?: number;
}): EventCandidate {
  const start = input.start ?? 0;
  const end = start + input.name.length;
  const anchor = {
    kind: input.anchorKind,
    name: input.name,
    regionCode: input.regionCode,
    span: { start, end, matchedText: input.name },
  } as const;
  return {
    id: buildCandidateId({
      rawMessageId: input.rawMessageId,
      spanStart: start,
      spanEnd: end,
      anchorKind: input.anchorKind,
      anchorName: input.name,
      authorProcessorId: input.authorProcessorId,
    }),
    anchor,
    eventType: input.eventType ?? "danger",
    extras: {},
    provenance: { eventTypeSource: "test", anchorSource: "test" },
    authorProcessorId: input.authorProcessorId,
    authorEnricherId: input.authorEnricherId,
    status: "active",
    mergeKey: buildCandidateMergeKey({
      spanStart: start,
      spanEnd: end,
      anchorKind: input.anchorKind,
      anchorName: input.name,
      regionCode: input.regionCode,
    }),
    trust: input.trust,
  };
}

function workspace(rawMessageId: string, candidates: EventCandidate[]): ParseWorkspace {
  return { ...createEmptyParseWorkspace(rawMessageId, "test"), candidates };
}

test("GF-P1-03: три spawned → один candidate деактивирует двух сирот", () => {
  const rawMessageId = "11111111-1111-1111-1111-111111111111";
  const kept = v2Candidate({
    rawMessageId,
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    trust: 80,
    anchorKind: "place",
    name: "Таганрог",
    regionCode: "ROS",
  });
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
  const bad = v2Candidate({
    rawMessageId,
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    trust: 80,
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

test("CRDT: LLM trust 90 побеждает catalog 80 на одном mergeKey независимо от порядка", () => {
  const rawMessageId = "33333333-3333-3333-3333-333333333333";
  const name = "Таганрог";
  const regionCode = "ROS";

  const makeWs = (order: "llm-first" | "catalog-first") => {
    const ws = createEmptyParseWorkspace(rawMessageId, `${name} danger`);
    const common = {
      workspace: ws,
      anchor: {
        kind: "place" as const,
        name,
        regionCode,
        span: { start: 0, end: name.length, matchedText: name },
      },
      eventType: "danger",
      provenance: { eventTypeSource: "test", anchorSource: "test" },
    };

    const appendLlm = () =>
      appendCandidate({
        ...common,
        authorProcessorId: "llm-processor",
        authorEnricherId: "llm",
        trust: 90,
      });
    const appendCatalog = () =>
      appendCandidate({
        ...common,
        authorProcessorId: "event-type-processor",
        authorEnricherId: "catalog",
        trust: 80,
        eventType: "attention",
      });

    if (order === "llm-first") {
      appendLlm();
      appendCatalog();
    } else {
      appendCatalog();
      appendLlm();
    }
    return ws;
  };

  for (const order of ["llm-first", "catalog-first"] as const) {
    const plan = planFinalize({
      workspace: makeWs(order),
      context: {
        mode: "initial",
        existingSpawnedIds: [],
        candidateEventMap: {},
        orphanPolicy: "deactivate",
      },
      postedAt: "2026-06-19T14:00:00.000Z",
    });
    assert.equal(plan.materialized.length, 1, order);
    assert.equal(plan.materialized[0]!.parsedEvent.eventType, "danger", order);
  }
});
