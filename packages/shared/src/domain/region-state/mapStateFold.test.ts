import assert from "node:assert/strict";
import test from "node:test";
import type { EventLocationFact } from "./mapStateFold";
import {
  foldMapState,
  isRegionVisibleInSnapshot,
  shouldIncomingBeatWinner,
} from "./mapStateFold";

const DAY_MS = 24 * 60 * 60 * 1000;
const asOf = new Date("2026-06-11T15:00:00.000Z");

function fact(overrides: Partial<EventLocationFact> & Pick<EventLocationFact, "factId">): EventLocationFact {
  return {
    regionId: "r-mos",
    regionCode: "RU-MOS",
    placeId: null,
    statusCode: "fixation",
    stateLevel: "red",
    action: "raise",
    occurredAt: "2026-06-11T11:47:07.000Z",
    authorChannelKey: "radar",
    entityKind: "region",
    ...overrides,
  };
}

test("shouldIncomingBeatWinner: более новый raise бьёт старый red", () => {
  const current = {
    regionId: "r1",
    regionCode: "RU-MOS",
    statusCode: "fixation",
    stateLevel: "red" as const,
    action: "raise" as const,
    occurredAt: "2026-06-11T10:00:00.000Z",
  };
  const incoming = fact({
    factId: "f2",
    occurredAt: "2026-06-11T12:00:00.000Z",
    stateLevel: "red",
  });
  assert.equal(shouldIncomingBeatWinner(current, incoming), true);
});

test("shouldIncomingBeatWinner: yellow не бьёт более старый red при более новом времени", () => {
  const current = {
    regionId: "r1",
    regionCode: "RU-MOS",
    statusCode: "fixation",
    stateLevel: "red" as const,
    action: "raise" as const,
    occurredAt: "2026-06-11T10:00:00.000Z",
  };
  const incoming = fact({
    factId: "f2",
    occurredAt: "2026-06-11T12:00:00.000Z",
    stateLevel: "yellow",
    statusCode: "attention",
  });
  assert.equal(shouldIncomingBeatWinner(current, incoming), false);
});

test("shouldIncomingBeatWinner: clear бьёт red при том же postedAt", () => {
  const current = {
    regionId: "r1",
    regionCode: "RU-MOS",
    statusCode: "fixation",
    stateLevel: "red" as const,
    action: "raise" as const,
    occurredAt: "2026-06-11T11:47:07.000Z",
  };
  const incoming = fact({
    factId: "f2",
    occurredAt: "2026-06-11T11:47:07.000Z",
    stateLevel: "green",
    statusCode: "cleared",
    action: "clear",
  });
  assert.equal(shouldIncomingBeatWinner(current, incoming), true);
});

test("foldMapState: place raise + region raise на одном postedAt", () => {
  const t = "2026-06-11T11:47:07.000Z";
  const result = foldMapState({
    asOf,
    ttlMs: DAY_MS,
    facts: [
      fact({ factId: "r1", entityKind: "region", placeId: null, occurredAt: t }),
      fact({
        factId: "p1",
        entityKind: "place",
        placeId: "place-1",
        occurredAt: t,
      }),
    ],
  });
  assert.equal(result.regions.length, 1);
  assert.equal(result.places.length, 1);
  assert.equal(result.regions[0]?.occurredAt, t);
  assert.equal(result.places[0]?.occurredAt, t);
});

test("foldMapState: региональный clear подавляет place raise", () => {
  const result = foldMapState({
    asOf,
    ttlMs: DAY_MS,
    facts: [
      fact({
        factId: "p1",
        entityKind: "place",
        placeId: "place-1",
        occurredAt: "2026-06-11T10:00:00.000Z",
      }),
      fact({
        factId: "c1",
        entityKind: "region",
        placeId: null,
        occurredAt: "2026-06-11T13:00:00.000Z",
        action: "clear",
        stateLevel: "green",
        statusCode: "cleared",
      }),
    ],
  });
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0]?.action, "clear");
  assert.equal(result.places.length, 0);
});

test("foldMapState: факты старше TTL не участвуют", () => {
  const result = foldMapState({
    asOf,
    ttlMs: DAY_MS,
    facts: [
      fact({
        factId: "old",
        occurredAt: "2026-06-08T10:00:00.000Z",
      }),
    ],
  });
  assert.equal(result.regions.length, 0);
});

test("isRegionVisibleInSnapshot: green старше 3ч скрыт", () => {
  const winner = {
    regionId: "r1",
    regionCode: "RU-MOS",
    statusCode: "cleared",
    stateLevel: "green" as const,
    action: "clear" as const,
    occurredAt: "2026-06-11T10:00:00.000Z",
  };
  assert.equal(isRegionVisibleInSnapshot(winner, asOf.getTime()), false);
});
