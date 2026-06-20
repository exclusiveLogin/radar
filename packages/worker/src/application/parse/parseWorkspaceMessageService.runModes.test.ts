import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryEventLocationRepository,
  InMemoryMessageParseWorkspaceRepository,
  InMemoryParsedEventRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../handlers/inMemoryRepositories.js";
import { createParseWorkspaceStack } from "./createParseWorkspaceStack.js";
import { createTestGeoValidation } from "./createTestGeoValidation.js";
import { buildTestPlaceScanService } from "../../domain/parse/geo/testPlaceScanFixture.js";

const regionRecord = {
  id: "44444444-4444-4444-4444-444444444401",
  code: "RU-BRY",
  iso: "RU-BRY",
  name: "Брянская область",
  fiasId: "f5807226-8be0-4ea8-91fc-39d053aec1e2",
  isActive: true,
};

const rawMessageId = "22222222-2222-2222-2222-222222222222";
const rawText =
  "Клинцы и близлежащие\nБрянская область\nОпасность по БПЛА";

test("phase_enrich: load workspace из БД без re-orchestrator", async () => {
  const placeScan = buildTestPlaceScanService();
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  await regions.upsertMany([regionRecord]);
  const parsedEvents = new InMemoryParsedEventRepository();
  const eventLocations = new InMemoryEventLocationRepository();
  const workspaces = new InMemoryMessageParseWorkspaceRepository();

  const { workspaceService } = createParseWorkspaceStack({
    placeScan,
    regions,
    places,
    validation: createTestGeoValidation(regions, places),
    parsedEvents,
    eventLocations,
    messageParseWorkspaces: workspaces,
  });

  const rebuild = await workspaceService.run({
    rawMessageId,
    rawText,
    postedAt: "2026-06-08T20:57:57.000Z",
    runKind: "rebuild",
    geoContext: { enrichers: ["catalog"] },
  });
  assert.equal(rebuild.kind, "event");
  if (rebuild.kind !== "event") return;

  const baselineCandidateCount = rebuild.workspace.candidates.length;
  assert.ok(baselineCandidateCount > 0);

  const stored = await workspaces.findActiveByRawMessageId(rawMessageId);
  assert.ok(stored);

  const enrich = await workspaceService.run({
    rawMessageId,
    rawText: "ignored-by-phase-enrich",
    postedAt: "2026-06-08T20:57:57.000Z",
    runKind: "phase_enrich",
    geoContext: { enrichers: ["llm"] },
  });
  assert.equal(enrich.kind, "event");
  if (enrich.kind !== "event") return;

  assert.equal(enrich.workspace.groomedText, stored!.groomedText);
  assert.ok(
    enrich.workspace.enricherRunLog.some((row) => row.enricherId === "llm"),
    "llm enricher должен отработать",
  );
  assert.ok(
    enrich.workspace.candidates.length >= baselineCandidateCount,
    "candidates не должны обнуляться phase_enrich",
  );
});

test("heal: без workspace → meta", async () => {
  const placeScan = buildTestPlaceScanService();
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  const parsedEvents = new InMemoryParsedEventRepository();
  const eventLocations = new InMemoryEventLocationRepository();
  const workspaces = new InMemoryMessageParseWorkspaceRepository();

  const { workspaceService } = createParseWorkspaceStack({
    placeScan,
    regions,
    places,
    validation: createTestGeoValidation(regions, places),
    parsedEvents,
    eventLocations,
    messageParseWorkspaces: workspaces,
  });

  const result = await workspaceService.run({
    rawMessageId: "33333333-3333-3333-3333-333333333333",
    rawText: "test",
    postedAt: "2026-06-08T20:57:57.000Z",
    runKind: "heal",
  });
  assert.equal(result.kind, "meta");
  assert.equal(result.reason, "heal_no_active_workspace");
});
