import assert from "node:assert/strict";
import test from "node:test";
import type { EventLocation, GeoEnrichmentArtifact } from "@radar/shared";
import {
  buildGeoEnrichmentState,
  parseGeoEnrichmentState,
  withGeoEnrichmentExtras,
} from "../../application/geo-pipeline/geoEnrichmentState.js";
import {
  InMemoryEventLocationRepository,
  InMemoryMessageParseWorkspaceRepository,
  InMemoryParsedEventRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../../application/handlers/inMemoryRepositories.js";
import { ParseRawMessageHandler } from "../../application/handlers/parseRawMessageHandler.js";
import { createParseWorkspaceMessageService } from "../../application/parse/createParseWorkspaceMessageService.js";
import { createTestGeoValidation } from "../../application/parse/createTestGeoValidation.js";
import { buildTestPlaceScanService } from "../../domain/parse/geo/testPlaceScanFixture.js";

const regionRecord = {
  id: "44444444-4444-4444-4444-444444444401",
  code: "RU-BRY",
  iso: "RU-BRY",
  name: "Брянская область",
  fiasId: "f5807226-8be0-4ea8-91fc-39d053aec1e2",
  isActive: true,
};

async function buildHandler(input: {
  enrichers: ("catalog" | "llm")[];
  regions: typeof regionRecord[];
  parsedEvents: InMemoryParsedEventRepository;
  eventLocations: InMemoryEventLocationRepository;
  workspaces: InMemoryMessageParseWorkspaceRepository;
  phaseMode: "baseline" | "enrich";
}) {
  const placeScan = buildTestPlaceScanService();
  const regionRepo = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  for (const region of input.regions) {
    await regionRepo.upsertMany([region]);
  }
  const workspaceService = createParseWorkspaceMessageService({
    placeScan,
    regions: regionRepo,
    places,
    validation: createTestGeoValidation(regionRepo, places),
    parsedEvents: input.parsedEvents,
    eventLocations: input.eventLocations,
    messageParseWorkspaces: input.workspaces,
  });
  return new ParseRawMessageHandler(
    workspaceService,
    input.parsedEvents,
    input.eventLocations,
    { append: async () => {} },
    { publish: async () => {} },
    { phaseId: input.phaseMode === "baseline" ? "catalog" : "llm", phaseMode: input.phaseMode, enrichers: input.enrichers, runKind: input.phaseMode === "baseline" ? "rebuild" : "phase_enrich" },
  );
}

const rawText =
  "Клинцы и близлежащие\nБрянская область\nОпасность по БПЛА";

test("enrich после catalog не затирает evloc при пустом llm delta", async () => {
  const parsedEvents = new InMemoryParsedEventRepository();
  const eventLocations = new InMemoryEventLocationRepository();
  const workspaces = new InMemoryMessageParseWorkspaceRepository();
  const raw = {
    id: "11111111-1111-1111-1111-111111111111",
    hash: "hash",
    channelKey: "radar",
    postedAt: "2026-06-08T20:57:57.000Z",
    rawText,
    sourceKind: "telegram" as const,
    providerKey: "test",
    externalMessageId: "1",
  };

  const baselineHandler = await buildHandler({
    enrichers: ["catalog"],
    regions: [regionRecord],
    parsedEvents,
    eventLocations,
    workspaces,
    phaseMode: "baseline",
  });
  await baselineHandler.handle(raw);

  const afterBaselineAll = await parsedEvents.findAllByRawMessageId(raw.id!);
  assert.ok(afterBaselineAll.length > 0);
  let baselineLocs: EventLocation[] = [];
  for (const row of afterBaselineAll) {
    const locs = await eventLocations.listForParsedEvent(row.id);
    if (locs.length > baselineLocs.length) baselineLocs = locs;
  }
  assert.ok(baselineLocs.length > 0);

  const enrichHandler = await buildHandler({
    enrichers: ["llm"],
    regions: [regionRecord],
    parsedEvents,
    eventLocations,
    workspaces,
    phaseMode: "enrich",
  });
  await enrichHandler.handle(raw);

  const afterEnrichAll = await parsedEvents.findAllByRawMessageId(raw.id!);
  let enrichLocs: EventLocation[] = [];
  for (const row of afterEnrichAll) {
    const locs = await eventLocations.listForParsedEvent(row.id);
    if (locs.length > enrichLocs.length) enrichLocs = locs;
  }
  assert.ok(enrichLocs.length > 0);
  assert.equal(enrichLocs[0]?.regionCode, "RU-BRY");
});

test("parseGeoEnrichmentState roundtrip", () => {
  const artifact: GeoEnrichmentArtifact = {
    catalog: {
      schemaVersion: 1,
      regions: [{ code: "RU-BRY", name: "Брянская область" }],
      places: [],
    },
  };
  const loc: EventLocation = {
    regionId: "00000000-0000-0000-0000-000000000001",
    regionCode: "RU-BRY",
    precision: "region",
    entityKind: "region",
    source: "db",
    placeName: "Брянская область",
  };
  const state = buildGeoEnrichmentState({
    artifact,
    validatedLocations: [loc],
    phaseId: "catalog",
  });
  const extras = withGeoEnrichmentExtras({}, state);
  const parsed = parseGeoEnrichmentState(extras);
  assert.equal(parsed?.validatedLocations?.length, 1);
  assert.equal(parsed?.catalog?.regions[0]?.code, "RU-BRY");
});
