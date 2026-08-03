import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryPlaceRepository, InMemoryRegionRepository } from "../../infrastructure/testing/inMemoryRepositories.js";
import { buildMaterializedEventLocations } from "./buildMaterializedEventLocations.js";
import { appendCandidate } from "./parseProcessorContract.js";
import { createEmptyParseWorkspace } from "./parseWorkspaceFactory.js";
import { extractContinuationFact } from "./extractContinuationFact.js";

const rawMessageId = "99999999-9999-9999-9999-999999999999";

function addAnchor(
  workspace: ReturnType<typeof createEmptyParseWorkspace>,
  kind: "place" | "region",
  name: string,
  regionCode: string,
): void {
  appendCandidate({
    workspace,
    authorProcessorId: "geo-processor",
    authorEnricherId: "catalog",
    anchor: {
      kind,
      name,
      regionCode,
      span: { start: 0, end: name.length, matchedText: name },
    },
    eventType: "cleared",
    provenance: { eventTypeSource: "test", anchorSource: "test" },
  });
}

test("continuation fixture: Новороссийск clear не очищает Краснодарский край", () => {
  const workspace = createEmptyParseWorkspace(
    rawMessageId,
    "Новороссийск — отбой. На территории Краснодарского края опасность сохраняется.",
  );
  addAnchor(workspace, "place", "Новороссийск", "RU-KDA");
  addAnchor(workspace, "region", "Краснодарский край", "RU-KDA");
  workspace.candidates[1]!.status = "rejected";

  assert.deepEqual(extractContinuationFact(workspace), {
    statusCode: "danger",
    regionCode: "RU-KDA",
  });
});

test("continuation fixture: multi-place Самара поднимает один региональный warning", () => {
  const workspace = createEmptyParseWorkspace(
    rawMessageId,
    "Сызрань, Октябрьск, Самара — отбой. В регионе внимание сохраняется.",
  );
  addAnchor(workspace, "place", "Сызрань", "RU-SAM");
  addAnchor(workspace, "place", "Октябрьск", "RU-SAM");
  addAnchor(workspace, "place", "Самара", "RU-SAM");

  assert.deepEqual(extractContinuationFact(workspace), {
    statusCode: "warning",
    regionCode: "RU-SAM",
  });
});

test("continuation: несколько регионов без явного региона не создают fact", () => {
  const workspace = createEmptyParseWorkspace(
    rawMessageId,
    "Отбой. Внимание сохраняется.",
  );
  addAnchor(workspace, "place", "Самара", "RU-SAM");
  addAnchor(workspace, "place", "Краснодар", "RU-KDA");

  assert.equal(extractContinuationFact(workspace), null);
});

test("continuation: Краснодарский local clear и regional danger материализуются отдельно", async () => {
  const workspace = createEmptyParseWorkspace(
    rawMessageId,
    "Новороссийск — отбой. На территории Краснодарского края опасность сохраняется.",
  );
  addAnchor(workspace, "place", "Новороссийск", "RU-KDA");
  addAnchor(workspace, "region", "Краснодарский край", "RU-KDA");
  workspace.candidates[1]!.status = "rejected";

  const regions = new InMemoryRegionRepository();
  await regions.upsertMany([{
    id: "region-kda",
    code: "RU-KDA",
    iso: "RU-KDA",
    name: "Краснодарский край",
    frontRegion: false,
    borderRegion: false,
  }]);
  const locations = await buildMaterializedEventLocations({
    workspace,
    materializedCandidateIds: [workspace.candidates[0]!.id],
    regions,
    places: new InMemoryPlaceRepository(),
    validation: {
      validate: async (_text, location) => ({ decision: "accepted", location }),
    } as never,
  });

  const facts = locations[workspace.candidates[0]!.id]!;
  assert.equal(facts.length, 2);
  assert.equal(facts[0]?.placeName, "Новороссийск");
  assert.equal(facts[0]?.entityKind, "place");
  assert.deepEqual(facts[1], {
    regionId: "region-kda",
    regionCode: "RU-KDA",
    placeName: "Краснодарский край",
    precision: "region",
    entityKind: "region",
    source: "db",
    confidence: 1,
    action: "raise",
    statusCode: "danger",
    meta: { continuation: true },
  });
});
