import assert from "node:assert/strict";
import test from "node:test";
import type { EventCandidate, ParseWorkspace } from "@radar/shared";
import { buildCandidateId, buildCandidateMergeKey } from "@radar/shared";
import { createTraitAttachment } from "./attachRule.js";
import { createEmptyParseWorkspace } from "./parseWorkspaceFactory.js";
import {
  EVENT_TYPE_TRAIT_KEY,
  pickPrimaryCandidate,
  resolveEventTypeForCandidate,
} from "./resolveEventTypeForCandidate.js";

function geoCandidate(rawMessageId: string, name: string, start = 0): EventCandidate {
  const end = start + name.length;
  const anchor = {
    kind: "place" as const,
    name,
    span: { start, end, matchedText: name },
  };
  return {
    id: buildCandidateId({
      rawMessageId,
      spanStart: start,
      spanEnd: end,
      anchorKind: "place",
      anchorName: name,
      authorProcessorId: "geo-processor",
    }),
    anchor,
    eventType: "unknown",
    extras: {},
    provenance: { eventTypeSource: "pending", anchorSource: "geo-processor" },
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    status: "active",
    mergeKey: buildCandidateMergeKey({
      spanStart: start,
      spanEnd: end,
      anchorKind: "place",
      anchorName: name,
    }),
    trust: 80,
  };
}

test("resolveEventTypeForCandidate: global trait + span-local override", () => {
  const rawMessageId = "44444444-4444-4444-4444-444444444444";
  const ws: ParseWorkspace = {
    ...createEmptyParseWorkspace(rawMessageId, "Елец danger"),
    candidates: [
      geoCandidate(rawMessageId, "Елец", 0),
      geoCandidate(rawMessageId, "Липецк", 20),
    ],
    traitAttachments: [
      createTraitAttachment({
        processorId: "event-type-processor",
        traitKey: EVENT_TYPE_TRAIT_KEY,
        value: "danger",
        attachRule: { scope: "all_candidates" },
      }),
      createTraitAttachment({
        processorId: "event-type-processor",
        traitKey: EVENT_TYPE_TRAIT_KEY,
        value: "fixation",
        attachRule: { scope: "by_span_overlap", span: { start: 0, end: 4 } },
      }),
    ],
  };

  const elets = ws.candidates[0]!;
  const lipetsk = ws.candidates[1]!;
  assert.equal(resolveEventTypeForCandidate(elets, ws), "fixation");
  assert.equal(resolveEventTypeForCandidate(lipetsk, ws), "danger");
});

test("pickPrimaryCandidate: пропускает rejected [0], берёт active с eventType", () => {
  const rawMessageId = "55555555-5555-5555-5555-555555555555";
  const rejected = {
    ...geoCandidate(rawMessageId, "Калужская", 0),
    status: "rejected" as const,
    anchor: {
      kind: "region" as const,
      name: "Калужская",
      span: { start: 0, end: 9, matchedText: "Калужская" },
    },
  };
  const active = geoCandidate(rawMessageId, "Куйбышевский район", 10);
  const ws: ParseWorkspace = {
    ...createEmptyParseWorkspace(rawMessageId, "Калужская Куйбышевский район Фиксации"),
    candidates: [rejected, active],
    traitAttachments: [
      createTraitAttachment({
        processorId: "event-type-processor",
        traitKey: EVENT_TYPE_TRAIT_KEY,
        value: "fixation",
        attachRule: { scope: "all_candidates" },
      }),
    ],
  };

  const primary = pickPrimaryCandidate(ws);
  assert.equal(primary?.id, active.id);
  assert.equal(resolveEventTypeForCandidate(primary!, ws), "fixation");
});
