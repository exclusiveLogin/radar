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

function fakeStatusDictionary(): IStatusDictionaryRepository {
  const entries = [
    { code: "alarm_threat", stateLevel: "red" },
    { code: "all_clear", stateLevel: "green" },
  ] as StatusDictionaryRecord[];
  return {
    listActive: async () => entries,
    findByCode: async (code: string) =>
      entries.find((entry) => entry.code === code) ?? null,
  };
}

function fakeRegions(): IRegionRepository {
  const region = { id: "r1", iso: "RU-A", name: "Регион А" } as RegionRecord;
  return { listActive: async () => [region] } as unknown as IRegionRepository;
}

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

function fakePlaceStatus() {
  const map = new Map<string, PlaceStatusActiveRecord>();
  const repo = {
    upsertActive: async (input: PlaceStatusActiveRecord) => {
      map.set(`${input.placeId}|${input.statusCode}`, input);
    },
    deactivate: async () => {},
    listActive: async () => [],
    listActiveByRegionId: async () => [],
    listAllActive: async () => [...map.values()],
    listActiveUpdatedBefore: async () => [],
  } as unknown as IPlaceStatusRepository;
  return { repo };
}

function buildEvent(postedAt: string, eventType = "alarm_threat"): DomainEvent {
  return buildDomainEvent({
    type: "MessageParsed",
    aggregateType: "parsed_event",
    aggregateId: "pe1",
    payload: {
      eventType,
      postedAt,
      locations: [
        { regionId: "r1", regionCode: "RU-A", placeId: "p1", precision: "locality" },
      ],
    },
  });
}

test("устаревшее событие не перебивает более новый статус региона", async () => {
  const regionState = fakeRegionState();
  const projection = new RegionStateProjection({
    regionState: regionState.repo,
    placeStatus: fakePlaceStatus().repo,
    statusDictionary: fakeStatusDictionary(),
    regions: fakeRegions(),
    adjacency: {},
  });

  await projection.handler(buildEvent("2026-06-01T10:00:00.000Z", "alarm_threat"));
  assert.equal(regionState.active.get("RU-A")?.stateLevel, "red");

  await projection.handler(buildEvent("2026-06-01T12:00:00.000Z", "all_clear"));
  assert.equal(regionState.active.get("RU-A")?.stateLevel, "green");

  await projection.handler(buildEvent("2026-06-01T08:00:00.000Z", "alarm_threat"));
  assert.equal(regionState.active.get("RU-A")?.stateLevel, "green");
  assert.equal(regionState.history.length, 2);
});
