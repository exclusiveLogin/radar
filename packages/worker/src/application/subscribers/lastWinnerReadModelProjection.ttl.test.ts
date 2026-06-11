import assert from "node:assert/strict";
import test from "node:test";
import type { DomainEvent } from "@radar/shared";
import { LastWinnerReadModelProjection } from "./lastWinnerReadModelProjection.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function fakeDictionary() {
  const entries = [
    { code: "alarm_threat", stateLevel: "red" },
    { code: "all_clear", stateLevel: "green" },
  ];
  return {
    listActive: async () => entries,
    findByCode: async (code: string) => entries.find((e) => e.code === code) ?? null,
  };
}

function buildEvent(postedAt: string): DomainEvent {
  return {
    type: "MessageParsed",
    aggregateType: "parsed_event",
    aggregateId: "pe-1",
    occurredAt: new Date().toISOString(),
    payload: {
      eventType: "alarm_threat",
      postedAt,
      locations: [
        {
          regionId: "r1",
          regionCode: "RU-MOS",
          placeId: "p1",
          entityKind: "place" as const,
        },
      ],
    },
  };
}

test("LastWinner: событие старше TTL по postedAt не пишет read-model (reparse)", async () => {
  let queries = 0;
  const projection = new LastWinnerReadModelProjection({
    dataSource: {
      query: async () => {
        queries += 1;
        return [];
      },
    } as never,
    statusDictionary: fakeDictionary(),
    mapStateTtlMs: DAY_MS,
  });

  const ancient = new Date(Date.now() - 2 * DAY_MS).toISOString();
  await projection.handler(buildEvent(ancient));
  assert.equal(queries, 0);
});

test("LastWinner: свежее postedAt проходит в upsert", async () => {
  let queries = 0;
  const projection = new LastWinnerReadModelProjection({
    dataSource: {
      query: async () => {
        queries += 1;
        return [];
      },
    } as never,
    statusDictionary: fakeDictionary(),
    mapStateTtlMs: DAY_MS,
  });

  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await projection.handler(buildEvent(recent));
  assert.ok(queries >= 2);
});
