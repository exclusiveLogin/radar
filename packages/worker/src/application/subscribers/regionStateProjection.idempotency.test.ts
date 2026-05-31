import assert from "node:assert/strict";
import test from "node:test";
import type {
  DomainEvent,
  IPlaceStatusRepository,
  IRegionRepository,
  IRegionStateRepository,
  IStatusDictionaryRepository,
  PlaceStatusActiveRecord,
  RegionRecord,
  RegionStateActiveRecord,
  StateLevel,
  StatusDictionaryRecord,
} from "@radar/shared";
import { buildDomainEvent } from "../handlers/domainEventFactory.js";
import { RegionStateProjection } from "./regionStateProjection.js";

/**
 * Инвариант Фазы 2: ре-эмит идентичного MessageParsed (фоновое обогащение,
 * повтор задачи) не должен задваивать place_status_active, историю смен и
 * счётчик активности. Проверяем монотонность проекции на in-memory фейках.
 */

function fakeStatusDictionary(level: StateLevel): IStatusDictionaryRepository {
  const entry = { code: "alarm_threat", stateLevel: level } as StatusDictionaryRecord;
  return {
    listActive: async () => [entry],
    findByCode: async () => entry,
  };
}

function fakeRegions(): IRegionRepository {
  const region = { id: "r1", iso: "RU-A", name: "Регион А" } as RegionRecord;
  return { listActive: async () => [region] } as unknown as IRegionRepository;
}

/** In-memory region_state с журналом истории. */
function fakeRegionState() {
  const active = new Map<string, RegionStateActiveRecord>();
  const history: Array<{ regionCode: string; stateLevel: string }> = [];
  const repo: IRegionStateRepository = {
    upsert: async (input) => {
      active.set(input.regionCode, input);
    },
    get: async () => null,
    listAll: async () => [...active.values()],
    listAlarmUpdatedBefore: async () => [],
    appendHistory: async (input) => {
      history.push({ regionCode: input.regionCode, stateLevel: input.stateLevel });
    },
  };
  return { repo, active, history };
}

/** In-memory place_status_active с ключом placeId|statusCode. */
function fakePlaceStatus() {
  const map = new Map<string, PlaceStatusActiveRecord>();
  const repo = {
    upsertActive: async (input: PlaceStatusActiveRecord) => {
      map.set(`${input.placeId}|${input.statusCode}`, input);
    },
    deactivate: async (placeId: string, statusCode: string) => {
      map.delete(`${placeId}|${statusCode}`);
    },
    listActive: async (placeId: string) =>
      [...map.values()].filter((r) => r.placeId === placeId),
    listActiveByRegionId: async () => [],
    listAllActive: async () => [...map.values()],
    listActiveUpdatedBefore: async () => [],
  } as unknown as IPlaceStatusRepository;
  return { repo, map };
}

function buildParsedEvent(): DomainEvent {
  return buildDomainEvent({
    type: "MessageParsed",
    aggregateType: "parsed_event",
    aggregateId: "pe1",
    payload: {
      eventType: "alarm_threat",
      postedAt: "2026-01-01T00:00:00.000Z",
      locations: [
        { regionId: "r1", regionCode: "RU-A", placeId: "p1", precision: "locality" },
      ],
    },
  });
}

test("ре-эмит MessageParsed идемпотентен: один place_status, одна история, activity=1", async () => {
  const regionState = fakeRegionState();
  const placeStatus = fakePlaceStatus();
  const projection = new RegionStateProjection({
    regionState: regionState.repo,
    placeStatus: placeStatus.repo,
    statusDictionary: fakeStatusDictionary("red"),
    regions: fakeRegions(),
    adjacency: {},
  });

  const event = buildParsedEvent();
  await projection.handler(event);
  await projection.handler(event); // повторная доставка (ре-эмит после обогащения)

  assert.equal(placeStatus.map.size, 1, "place_status_active не должен задваиваться");
  assert.equal(regionState.history.length, 1, "история смен — ровно один переход grey→red");
  assert.equal(regionState.active.get("RU-A")?.stateLevel, "red");
  assert.equal(regionState.active.get("RU-A")?.activity, 1, "activity не должна расти на повторе");
});
