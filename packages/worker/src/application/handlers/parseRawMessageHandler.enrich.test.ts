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
  InMemoryParsedEventRepository,
} from "../../application/handlers/inMemoryRepositories.js";
import { ParseRawMessageHandler } from "../../application/handlers/parseRawMessageHandler.js";
import { GeoValidationService } from "../../application/parsing/geoValidationService.js";
import { createParsePipeline } from "../../application/parsing/createParsePipeline.js";
import { GeoCatalog } from "../../infrastructure/geo-catalog/index.js";

const regionRecord = {
  id: "reg-bry",
  code: "RU-BRY",
  iso: "RU-BRY",
  name: "Брянская область",
  fiasId: "f5807226-8be0-4ea8-91fc-39d053aec1e2",
  isActive: true,
};

function buildHandler(input: {
  enrichers: ("catalog" | "llm")[];
  regions: typeof regionRecord[];
  parsedEvents: InMemoryParsedEventRepository;
  eventLocations: InMemoryEventLocationRepository;
  phaseMode: "baseline" | "enrich";
}) {
  const geoCatalog = GeoCatalog.loadFromArtifacts();
  const { pipeline } = createParsePipeline(
    {
      enricherFlags: {
        llm: input.enrichers.includes("llm"),
        dadata: false,
        nominatim: false,
      },
      pipelineOrder: input.enrichers,
      llmRuntimeConfig: {
        enabled: false,
        provider: "ollama",
        model: "test",
        timeoutMs: 1000,
        retryCount: 0,
        temperature: 0,
        maxTokens: 100,
        jsonMode: true,
        baseUrl: "http://127.0.0.1:11434",
        headers: {},
      },
    },
    undefined,
    geoCatalog,
  );
  const validation = new GeoValidationService(
    {
      listActive: async () => input.regions,
      findByCode: async (code: string) =>
        input.regions.find((r) => r.iso === code || r.code === code) ?? null,
      findById: async (id: string) =>
        input.regions.find((r) => r.id === id) ?? null,
      upsertMany: async () => {},
    },
    { upsertMany: async () => {}, findById: async () => null, findByFias: async () => null, findByStemInRegion: async () => null, findByNameInRegion: async () => null, mergeContribution: async () => ({ updated: {} as never, appliedFields: [] }) },
    { upsertAlias: async () => {}, findByAlias: async () => [] },
  );
  return new ParseRawMessageHandler(
    pipeline,
    input.parsedEvents,
    input.eventLocations,
    { append: async () => {} },
    { upsertMany: async () => {}, findById: async () => null, findByFias: async () => null, findByStemInRegion: async () => null, findByNameInRegion: async () => null, mergeContribution: async () => ({ updated: {} as never, appliedFields: [] }) },
    validation,
    { publish: async () => {} },
    undefined,
    { phaseId: input.phaseMode === "baseline" ? "catalog" : "llm", phaseMode: input.phaseMode },
  );
}

const rawText =
  "Клинцы и близлежащие\nБрянская область\nОпасность по БПЛА";

test("enrich после catalog не затирает evloc при пустом llm delta", async () => {
  const parsedEvents = new InMemoryParsedEventRepository();
  const eventLocations = new InMemoryEventLocationRepository();
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

  const baselineHandler = buildHandler({
    enrichers: ["catalog"],
    regions: [regionRecord],
    parsedEvents,
    eventLocations,
    phaseMode: "baseline",
  });
  await baselineHandler.handle(raw);

  const afterBaseline = await parsedEvents.findByRawMessageId(raw.id!);
  assert.ok(afterBaseline);
  const baselineLocs = await eventLocations.listForParsedEvent(afterBaseline!.id);
  assert.ok(baselineLocs.length > 0);

  const enrichHandler = buildHandler({
    enrichers: ["llm"],
    regions: [regionRecord],
    parsedEvents,
    eventLocations,
    phaseMode: "enrich",
  });
  await enrichHandler.handle(raw);

  const afterEnrich = await parsedEvents.findByRawMessageId(raw.id!);
  const enrichLocs = await eventLocations.listForParsedEvent(afterEnrich!.id);
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
