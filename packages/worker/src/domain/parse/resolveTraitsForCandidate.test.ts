import assert from "node:assert/strict";
import test from "node:test";
import type { EventCandidate, ParseWorkspace, TraitAttachment } from "@radar/shared";
import { randomUUID } from "node:crypto";
import {
  materializeCandidateExtras,
  resolveTraitsForCandidate,
} from "./resolveTraitsForCandidate.js";
import { candidateToParsedEvent } from "./candidateToParsedEvent.js";
import { planFinalizeMerge } from "./planFinalizeMerge.js";
import { createEmptyParseWorkspace } from "./parseWorkspaceFactory.js";
import { appendCandidate } from "./parseProcessorContract.js";
import { runRepeatProcessor, runMassProcessor, runCountProcessor, runUncertainProcessor, runMultipleFixationProcessor } from "./traitProcessors.js";

function geoCandidate(id: string, kind: "place" | "region" = "place"): EventCandidate {
  return {
    id,
    anchor: {
      kind,
      name: kind === "place" ? "Клинцы" : "Брянская область",
      regionCode: "RU-BRY",
      span: { start: 0, end: 5, matchedText: "Клинцы" },
    },
    eventType: "danger",
    extras: {},
    provenance: { eventTypeSource: "geo-processor", anchorSource: "geo-processor" },
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    status: "active",
    mergeKey: `mk-${id}`,
    trust: 80,
  };
}

function workspaceWithCandidates(candidates: EventCandidate[]): ParseWorkspace {
  return {
    ...createEmptyParseWorkspace(randomUUID(), "повторная опасность по Клинцам"),
    candidates,
  };
}

test("resolveTraitsForCandidate: repeat → all_candidates", () => {
  const c1 = geoCandidate("c1");
  const c2 = geoCandidate("c2", "region");
  const ws = workspaceWithCandidates([c1, c2]);
  ws.traitAttachments.push({
    id: randomUUID(),
    processorId: "repeat-processor",
    traitKey: "repeat",
    value: true,
    attachRule: { scope: "all_candidates" },
  });

  assert.equal(resolveTraitsForCandidate(c1, ws.traitAttachments, ws).repeat, true);
  assert.equal(resolveTraitsForCandidate(c2, ws.traitAttachments, ws).repeat, true);
});

test("resolveTraitsForCandidate: mass → только place", () => {
  const place = geoCandidate("p1", "place");
  const region = geoCandidate("r1", "region");
  const ws = workspaceWithCandidates([place, region]);
  ws.traitAttachments.push({
    id: randomUUID(),
    processorId: "mass-processor",
    traitKey: "mass",
    value: true,
    attachRule: { scope: "by_kind", kind: "place" },
  });

  assert.equal(resolveTraitsForCandidate(place, ws.traitAttachments, ws).mass, true);
  assert.equal(resolveTraitsForCandidate(region, ws.traitAttachments, ws).mass, undefined);
});

test("resolveTraitsForCandidate: count → first", () => {
  const first = geoCandidate("f1");
  const second = geoCandidate("f2");
  const ws = workspaceWithCandidates([first, second]);
  ws.traitAttachments.push({
    id: randomUUID(),
    processorId: "count-processor",
    traitKey: "count",
    value: 3,
    attachRule: { scope: "first" },
  });

  assert.equal(resolveTraitsForCandidate(first, ws.traitAttachments, ws).count, 3);
  assert.equal(resolveTraitsForCandidate(second, ws.traitAttachments, ws).count, undefined);
});

test("resolveTraitsForCandidate: llm processor выше repeat на одном ключе", () => {
  const candidate = geoCandidate("c1");
  const ws = workspaceWithCandidates([candidate]);
  const attachments: TraitAttachment[] = [
    {
      id: randomUUID(),
      processorId: "repeat-processor",
      traitKey: "repeat",
      value: true,
      attachRule: { scope: "all_candidates" },
    },
    {
      id: randomUUID(),
      processorId: "llm-processor",
      traitKey: "repeat",
      value: false,
      attachRule: { scope: "all_candidates" },
    },
  ];

  assert.equal(resolveTraitsForCandidate(candidate, attachments, ws).repeat, false);
});

test("materializeCandidateExtras: legacy extras.repeat игнорируется без attachment", () => {
  const candidate = geoCandidate("c1");
  candidate.extras.repeat = true;
  const ws = workspaceWithCandidates([candidate]);
  assert.equal(materializeCandidateExtras(candidate, ws).repeat, undefined);
});

test("trait processors + finalize: repeat в parsed_events", () => {
  const ws = createEmptyParseWorkspace(
    randomUUID(),
    "повторная опасность\nКлинцы\nБрянская область",
  );
  appendCandidate({
    workspace: ws,
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    anchor: {
      kind: "place",
      name: "Клинцы",
      regionCode: "RU-BRY",
      span: { start: 0, end: 6, matchedText: "Клинцы" },
    },
    eventType: "danger",
    provenance: { eventTypeSource: "geo-processor", anchorSource: "geo-processor" },
  });
  appendCandidate({
    workspace: ws,
    authorProcessorId: "event-type-processor",
    authorEnricherId: "catalog",
    anchor: {
      kind: "place",
      name: "Клинцы",
      regionCode: "RU-BRY",
      span: { start: 0, end: 6, matchedText: "Клинцы" },
    },
    eventType: "danger",
    provenance: { eventTypeSource: "event-type-processor", anchorSource: "geo-processor" },
  });

  runRepeatProcessor(ws);
  assert.equal(ws.candidates[0]?.extras.repeat, undefined);

  const winner = ws.candidates.find((c) => c.authorProcessorId === "event-type-processor")!;
  const plan = planFinalizeMerge({
    workspace: ws,
    context: {
      mode: "initial",
      existingSpawnedIds: [],
      candidateEventMap: {},
      orphanPolicy: "deactivate",
    },
    postedAt: "2026-06-08T20:00:00.000Z",
  });

  assert.equal(plan.materialized.length, 1);
  const parsed = plan.materialized[0]!.parsedEvent;
  assert.equal(parsed.repeat, true);

  const direct = candidateToParsedEvent({
    workspace: ws,
    candidate: winner,
    postedAt: "2026-06-08T20:00:00.000Z",
  });
  assert.equal(direct.repeat, true);
});

test("runCountProcessor: count только на first через finalize projection", () => {
  const ws = createEmptyParseWorkspace(randomUUID(), "от 3 бпла\nКлинцы");
  appendCandidate({
    workspace: ws,
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    anchor: {
      kind: "place",
      name: "Клинцы",
      span: { start: 0, end: 6, matchedText: "Клинцы" },
    },
    eventType: "danger",
    provenance: { eventTypeSource: "geo-processor", anchorSource: "geo-processor" },
  });
  runCountProcessor(ws);

  const plan = planFinalizeMerge({
    workspace: ws,
    context: {
      mode: "initial",
      existingSpawnedIds: [],
      candidateEventMap: {},
      orphanPolicy: "deactivate",
    },
    postedAt: "2026-06-08T20:00:00.000Z",
  });
  assert.equal(plan.materialized[0]?.parsedEvent.count, 3);
});

test("runMassProcessor: mass на place, не на region", () => {
  const ws = createEmptyParseWorkspace(randomUUID(), "массированный обстрел\nКлинцы\nБрянская область");
  appendCandidate({
    workspace: ws,
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    anchor: {
      kind: "place",
      name: "Клинцы",
      span: { start: 0, end: 6, matchedText: "Клинцы" },
    },
    eventType: "danger",
    provenance: { eventTypeSource: "geo-processor", anchorSource: "geo-processor" },
  });
  appendCandidate({
    workspace: ws,
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    anchor: {
      kind: "region",
      name: "Брянская область",
      regionCode: "RU-BRY",
      span: { start: 0, end: 10, matchedText: "Брянская" },
    },
    eventType: "danger",
    provenance: { eventTypeSource: "geo-processor", anchorSource: "geo-processor" },
  });
  runMassProcessor(ws);

  const placeWinner = ws.candidates.find((c) => c.anchor.kind === "place")!;
  const regionWinner = ws.candidates.find((c) => c.anchor.kind === "region")!;
  assert.equal(materializeCandidateExtras(placeWinner, ws).mass, true);
  assert.equal(materializeCandidateExtras(regionWinner, ws).mass, undefined);
});

test("uncertain-processor: «возможно» → trait на всех candidates", () => {
  const ws = workspaceWithCandidates([
    geoCandidate("p1", "place"),
    geoCandidate("r1", "region"),
  ]);
  ws.groomedText = "Кузнецкий район — возможно фиксация";
  runUncertainProcessor(ws);

  for (const candidate of ws.candidates) {
    assert.equal(
      materializeCandidateExtras(candidate, ws).uncertain,
      true,
      candidate.anchor.kind,
    );
  }
});

test("multiple-processor: «множественная фиксация» → trait multiple", () => {
  const ws = workspaceWithCandidates([geoCandidate("p1", "place")]);
  ws.groomedText = "Множественная фиксация БПЛА над городом";
  runMultipleFixationProcessor(ws);
  assert.equal(materializeCandidateExtras(ws.candidates[0]!, ws).multiple, true);
});
