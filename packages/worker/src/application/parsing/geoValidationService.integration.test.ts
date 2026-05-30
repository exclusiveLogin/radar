import assert from "node:assert/strict";
import test from "node:test";
import { GeoValidationService } from "./geoValidationService.js";
import {
  InMemoryPlaceAliasRepository,
  InMemoryPlaceEvidenceRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../handlers/inMemoryRepositories.js";

test("geo validation keeps monotonic merge across lower and higher contributions", async () => {
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  const aliases = new InMemoryPlaceAliasRepository();
  const evidence = new InMemoryPlaceEvidenceRepository();
  const service = new GeoValidationService(regions, places, aliases, evidence);

  const region = await regions.findByCode("31");
  assert.ok(region);

  const placeId = "place-monotonic";
  await places.upsertMany([
    {
      id: placeId,
      regionId: region.id,
      kind: "locality",
      name: "Старое место",
      trustState: "verified",
      isTrusted: true,
      trustScore: 0.95,
      evidenceProviders: ["catalog"],
    },
  ]);

  await service.validate(
    "сообщение 1",
    {
      regionId: region.id,
      regionCode: "31",
      placeName: "Старое место",
      placeFias: "fias-1",
      precision: "city",
      source: "llm",
    },
    { providerHint: "llm", confidence: 0.55, traceId: "t-low" },
  );

  await service.validate(
    "сообщение 2",
    {
      regionId: region.id,
      regionCode: "31",
      placeName: "Новое место",
      placeFias: "fias-1",
      precision: "city",
      source: "dadata",
      lat: 51.123456,
      lon: 37.654321,
    },
    { providerHint: "dadata", confidence: 0.99, traceId: "t-high" },
  );

  const updated = await places.findById(placeId);
  assert.ok(updated);
  assert.equal(updated.name, "Новое место");
  assert.equal(updated.fiasId, "fias-1");
  assert.equal(updated.trustScore, 0.99);
  assert.equal(updated.isTrusted, true);
  assert.equal(updated.trustState, "verified");
  assert.equal(updated.centroidLat, 51.123456);
  assert.equal(updated.centroidLon, 37.654321);
  assert.deepEqual(updated.evidenceProviders?.sort(), ["catalog", "dadata", "llm"]);

  const rows = await evidence.listByPlace(placeId, 10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.action, "enrich");
  assert.equal(rows[1]?.action, "enrich");
});

test("geo validation: alias match only within same region", async () => {
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  const aliases = new InMemoryPlaceAliasRepository();
  const evidence = new InMemoryPlaceEvidenceRepository();
  const service = new GeoValidationService(regions, places, aliases, evidence);

  const ulyId = "73f73f73-f73f-473f-973f-73f73f73f73f";
  const khaId = "27f27f27-f27f-427f-927f-27f27f27f27f";
  await regions.upsertMany([
    {
      id: ulyId,
      code: "73",
      name: "Ульяновская область",
      frontRegion: false,
      borderRegion: false,
    },
    {
      id: khaId,
      code: "27",
      name: "Хабаровский край",
      frontRegion: false,
      borderRegion: false,
    },
  ]);

  const uly = await regions.findByCode("73");
  const kha = await regions.findByCode("27");
  assert.ok(uly);
  assert.ok(kha);

  const wrongPlaceId = "place-kha-nikolaevsky";
  await places.upsertMany([
    {
      id: wrongPlaceId,
      regionId: kha.id,
      kind: "locality",
      name: "Николаевский район",
      centroidLat: 53.089791,
      centroidLon: 140.225863,
      trustState: "verified",
      isTrusted: true,
      trustScore: 0.95,
      evidenceProviders: ["dadata"],
    },
  ]);
  await aliases.upsertAlias({
    targetKind: "place",
    placeId: wrongPlaceId,
    alias: "Николаевский район",
    source: "auto",
  });

  const result = await service.validate(
    "Николаевский район Ульяновская область",
    {
      regionId: uly.id,
      regionCode: "73",
      placeName: "Николаевский район",
      precision: "district",
      source: "llm",
    },
    { providerHint: "llm", confidence: 0.8 },
  );

  assert.equal(result.decision, "created_new");
  assert.ok(result.location?.placeId);
  assert.notEqual(result.location?.placeId, wrongPlaceId);

  const created = await places.findById(result.location!.placeId!);
  assert.ok(created);
  assert.equal(created.regionId, uly.id);
});
