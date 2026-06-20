import assert from "node:assert/strict";
import test from "node:test";
import type { EventCandidate, ParseWorkspace } from "@radar/shared";
import { buildCandidateId, buildCandidateMergeKey } from "@radar/shared";
import {
  InMemoryEventLocationRepository,
  InMemoryMessageParseWorkspaceRepository,
  InMemoryParsedEventRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../../application/handlers/inMemoryRepositories.js";
import { createTestGeoValidation } from "../../application/parse/createTestGeoValidation.js";
import { ParseWorkspacePersistService } from "../../application/parse/ParseWorkspacePersistService.js";
import { createTraitAttachment } from "./attachRule.js";
import { planFinalize } from "./ParseFinalizerService.js";
import { createEmptyParseWorkspace } from "./parseWorkspaceFactory.js";
import { EVENT_TYPE_TRAIT_KEY } from "./resolveEventTypeForCandidate.js";

const rawMessageId = "55555555-5555-5555-5555-555555555555";

function placeCandidate(name: string, start: number, regionCode = "RU-LIP"): EventCandidate {
  const end = start + name.length;
  const anchor = {
    kind: "place" as const,
    name,
    regionCode,
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
      regionCode,
    }),
    trust: 80,
  };
}

test("persist: multi-anchor → distinct parsed_event ids", async () => {
  const regions = new InMemoryRegionRepository();
  await regions.upsertMany([
    {
      id: "reg-lip",
      code: "RU-LIP",
      iso: "RU-LIP",
      name: "Липецкая область",
      isActive: true,
    },
  ]);

  const workspace: ParseWorkspace = {
    ...createEmptyParseWorkspace(rawMessageId, "Елец и Липецк danger"),
    candidates: [placeCandidate("Елец", 0), placeCandidate("Липецк", 10)],
    traitAttachments: [
      createTraitAttachment({
        processorId: "event-type-processor",
        traitKey: EVENT_TYPE_TRAIT_KEY,
        value: "danger",
        attachRule: { scope: "all_candidates" },
      }),
    ],
  };

  const parsedEvents = new InMemoryParsedEventRepository();
  const eventLocations = new InMemoryEventLocationRepository();
  const workspaces = new InMemoryMessageParseWorkspaceRepository();
  const persist = new ParseWorkspacePersistService(
    parsedEvents,
    eventLocations,
    workspaces,
  );
  const validation = createTestGeoValidation(regions);
  const places = new InMemoryPlaceRepository();

  const plan = planFinalize({
    workspace,
    context: {
      mode: "initial",
      existingSpawnedIds: [],
      candidateEventMap: {},
      orphanPolicy: "deactivate",
    },
    postedAt: "2026-06-20T00:18:08.000Z",
  });
  assert.equal(plan.materialized.length, 2);

  const { buildMaterializedEventLocations } = await import("./buildMaterializedEventLocations.js");
  const locationsByCandidateId = await buildMaterializedEventLocations({
    workspace,
    materializedCandidateIds: plan.materialized.map((item) => item.candidateId),
    regions,
    places,
    validation,
  });

  const result = await persist.finalize({
    workspace,
    context: {
      mode: "initial",
      existingSpawnedIds: [],
      candidateEventMap: {},
      orphanPolicy: "deactivate",
    },
    postedAt: "2026-06-20T00:18:08.000Z",
    parserRevision: "test",
    locationsByCandidateId,
  });

  const uniqueIds = new Set(result.spawnedEventIds);
  assert.equal(uniqueIds.size, 2);
  assert.equal(result.spawnedEventIds.length, 2);
});
