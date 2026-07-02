import assert from "node:assert/strict";
import test from "node:test";
import { placeStem, type PlaceRecord } from "@radar/shared";
import { GeoValidationService } from "./geoValidationService.js";
import {
  InMemoryPlaceAliasRepository,
  InMemoryPlaceRepository,
  InMemoryRegionRepository,
} from "../handlers/inMemoryRepositories.js";

test("geo validation keeps monotonic merge across lower and higher contributions", async () => {
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  const aliases = new InMemoryPlaceAliasRepository();
  const service = new GeoValidationService(regions, places, aliases);

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
      placeName: "Старое место",
      placeFias: "fias-1",
      precision: "city",
      source: "dadata",
      lat: 51.123456,
      lon: 37.654321,
    },
    { providerHint: "dadata", confidence: 0.99, traceId: "t-high", allowPlaceUpdates: true },
  );

  const updated = await places.findById(placeId);
  assert.ok(updated);
  assert.equal(updated.name, "Старое место");
  assert.equal(updated.fiasId, "fias-1");
  assert.equal(updated.trustScore, 0.99);
  assert.equal(updated.isTrusted, true);
  assert.equal(updated.trustState, "verified");
  assert.equal(updated.centroidLat, 51.123456);
  assert.equal(updated.centroidLon, 37.654321);
  assert.deepEqual(updated.evidenceProviders?.sort(), ["catalog", "dadata"]);

});

test("geo validation: alias match only within same region", async () => {
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  const aliases = new InMemoryPlaceAliasRepository();
  const service = new GeoValidationService(regions, places, aliases);

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

test("geo validation: region alias resolves via place(kind=region)", async () => {
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  const aliases = new InMemoryPlaceAliasRepository();
  const service = new GeoValidationService(regions, places, aliases);

  const regionId = "73f73f73-f73f-473f-973f-73f73f73f73f";
  const regionPlaceId = "place-uly-region";
  await regions.upsertMany([
    {
      id: regionId,
      code: "73",
      name: "Ульяновская область",
      frontRegion: false,
      borderRegion: false,
    },
  ]);
  await places.upsertMany([
    {
      id: regionPlaceId,
      regionId,
      kind: "region",
      name: "Ульяновская область",
      trustState: "verified",
      isTrusted: true,
      trustScore: 1,
      evidenceProviders: ["catalog"],
    },
  ]);
  await aliases.upsertAlias({
    placeId: regionPlaceId,
    alias: "ульяновская обл",
    source: "manual",
  });

  const result = await service.validate(
    "событие",
    {
      regionId,
      regionCode: "ульяновская обл",
      placeName: "Ульяновск",
      precision: "city",
      source: "llm",
    },
    { providerHint: "llm", confidence: 0.8 },
  );

  assert.notEqual(result.decision, "rejected");
  assert.equal(result.location?.regionId, regionId);
});

test("geo validation: channel brand 24/7 without catalog region — rejected", async () => {
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  const aliases = new InMemoryPlaceAliasRepository();
  const service = new GeoValidationService(regions, places, aliases);

  const nizhId = "52f52f52-f52f-452f-952f-52f52f52f52f";
  await regions.upsertMany([
    {
      id: nizhId,
      code: "52",
      name: "Нижегородская область",
      frontRegion: false,
      borderRegion: false,
    },
  ]);

  const result = await service.validate(
    "новость …, Нижегородская обл",
    {
      regionId: nizhId,
      regionCode: "52",
      placeName: "Иркутск 24/7",
      precision: "city",
      source: "db",
    },
    { multiPlaceContext: false },
  );

  assert.equal(result.decision, "rejected");
  assert.equal(result.location, null);
});

test("geo validation: garbage place name — rejected even with regionCode", async () => {
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  const aliases = new InMemoryPlaceAliasRepository();
  const service = new GeoValidationService(regions, places, aliases);

  const nizhId = "52f52f52-f52f-452f-952f-52f52f52f52f";
  await regions.upsertMany([
    {
      id: nizhId,
      code: "52",
      name: "Нижегородская область",
      frontRegion: false,
      borderRegion: false,
    },
  ]);

  const result = await service.validate(
    "Впервые регионы РФ подверглись массовым РАКЕТНЫМ атакам, Нижегородская обл",
    {
      regionId: nizhId,
      regionCode: "52",
      placeName:
        "Впервые регионы РФ подверглись массовым РАКЕТНЫМ атакам от ВСУ",
      precision: "city",
      source: "db",
    },
    { multiPlaceContext: false },
  );

  assert.equal(result.decision, "rejected");
});

test("geo validation: district с pipeline regionCode и коротким DB-name субъекта", async () => {
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  const aliases = new InMemoryPlaceAliasRepository();
  const service = new GeoValidationService(regions, places, aliases);

  const kluId = "1859fdf6-93ac-4bee-afda-51c5b90a4db9";
  const districtId = "6d52943c-44ec-49aa-b067-d1b634143184";
  await regions.upsertMany([
    {
      id: kluId,
      code: "RU-KLU",
      name: "Калужская",
      frontRegion: false,
      borderRegion: false,
    },
  ]);
  await places.upsertMany([
    {
      id: districtId,
      regionId: kluId,
      kind: "district",
      name: "Хвастовичский район",
      nameStem: placeStem("Хвастовичский район"),
      trustState: "verified",
      isTrusted: true,
      trustScore: 1,
      evidenceProviders: ["catalog"],
    },
  ]);

  const rawText = "Хвастовичский район\nКалужская область\nФиксация БПЛА";
  const result = await service.validate(
    rawText,
    {
      regionId: kluId,
      regionCode: "RU-KLU",
      placeName: "Хвастовичский район",
      precision: "district",
      entityKind: "place",
      source: "db",
    },
    { multiPlaceContext: false },
  );

  assert.equal(result.decision, "matched_existing");
  assert.equal(result.location?.placeId, districtId);
  assert.equal(result.location?.entityKind, "place");
  assert.equal(result.location?.regionCode, "RU-KLU");
});

/** Имитирует TypeORM upsertMany: merge по region+kind+nameNormalized, id из existing. */
class DedupingPlaceRepository extends InMemoryPlaceRepository {
  async upsertMany(places: PlaceRecord[]): Promise<void> {
    for (const place of places) {
      const existing = (await this.listActive()).find(
        (row) =>
          row.regionId === place.regionId
          && row.kind === place.kind
          && row.name.toLowerCase().trim() === place.name.toLowerCase().trim(),
      );
      await super.upsertMany([
        { ...place, id: existing?.id ?? place.id },
      ]);
    }
  }
}

test("geo validation: created_new alias не ломает FK при dedup upsertMany", async () => {
  const regions = new InMemoryRegionRepository();
  const places = new DedupingPlaceRepository();
  const aliases = new InMemoryPlaceAliasRepository();
  const service = new GeoValidationService(regions, places, aliases);

  const mosId = "29251dcf-00a1-4e34-98d4-5c47484a36d4";
  await regions.upsertMany([
    {
      id: mosId,
      code: "RU-MOS",
      iso: "RU-MOS",
      name: "Московская",
      frontRegion: false,
      borderRegion: false,
    },
  ]);

  const location = {
    regionId: mosId,
    regionCode: "RU-MOS",
    placeName: "ГО Тестовый-Stub-Reparse",
    precision: "city" as const,
    source: "llm" as const,
  };

  const first = await service.validate("ГО Тестовый-Stub-Reparse", location);
  assert.equal(first.decision, "created_new");
  const firstId = first.location?.placeId;
  assert.ok(firstId);

  const second = await service.validate("ГО Тестовый-Stub-Reparse", location);
  assert.ok(
    second.decision === "created_new" || second.decision === "matched_existing",
  );
  assert.equal(second.location?.placeId, firstId);
});

test("geo validation: catalogHeal запрещает created_new на parse-path", async () => {
  const regions = new InMemoryRegionRepository();
  const places = new InMemoryPlaceRepository();
  const aliases = new InMemoryPlaceAliasRepository();
  const service = new GeoValidationService(regions, places, aliases);

  const mosId = "29251dcf-00a1-4e34-98d4-5c47484a36d4";
  await regions.upsertMany([
    {
      id: mosId,
      code: "RU-MOS",
      iso: "RU-MOS",
      name: "Московская",
      frontRegion: false,
      borderRegion: false,
    },
  ]);

  const result = await service.validate(
    "Новый НП без каталога",
    {
      regionId: mosId,
      regionCode: "RU-MOS",
      placeName: "Новый НП без каталога",
      precision: "city",
      source: "llm",
    },
    { catalogHeal: true },
  );

  assert.equal(result.decision, "rejected");
  assert.equal(result.location, null);
  assert.equal((await places.listActive()).length, 0);
});
