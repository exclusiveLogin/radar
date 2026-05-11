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
