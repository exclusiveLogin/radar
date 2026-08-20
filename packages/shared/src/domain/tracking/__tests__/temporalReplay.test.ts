import { describe, expect, test } from "vitest";
import {
  orderTrackingCandidates,
  resolveTrackingTemporalReplay,
  trackingReplayLookbackMs,
} from "../temporalReplay";
import type { TrackingCandidate } from "../types";

const MINUTE = 60_000;
const BASE = Date.UTC(2026, 6, 18, 0, 0, 0);

function candidate(id: string, offsetMinutes: number): TrackingCandidate {
  return {
    eventLocationId: id,
    parsedEventId: id,
    occurredAt: new Date(BASE + offsetMinutes * MINUTE),
    lat: 50,
    lon: 36,
    placeId: null,
    precision: "coords",
    trust: 0.8,
    eventType: "uav",
    eventCategory: null,
    affectsKinematics: true,
    isFrontRegion: true,
    threatProfile: "uav",
    mode: "correct",
    sourceRefs: [{ eventLocationId: id }],
  };
}

describe("temporal replay", () => {
  test("event-time stream does not depend on arrival order or batch size", () => {
    const events = [
      candidate("00000000-0000-0000-0000-000000000003", 3),
      candidate("00000000-0000-0000-0000-000000000001", 1),
      candidate("00000000-0000-0000-0000-000000000002", 2),
    ];
    const expected = [
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      "00000000-0000-0000-0000-000000000003",
    ];
    const ordered = orderTrackingCandidates(events);

    expect(ordered.map(event => event.eventLocationId)).toEqual(expected);
    expect(drainInBatches(ordered, 1)).toEqual(expected);
    expect(drainInBatches(ordered, 2)).toEqual(expected);
  });

  test("late event resets deterministic tail from domain replay horizon", () => {
    const watermark = {
      lastOccurredAt: new Date(BASE + 10 * MINUTE).toISOString(),
      lastEventLocationId: "00000000-0000-0000-0000-000000000010",
    };
    const late = candidate("00000000-0000-0000-0000-000000000005", 5);
    const replay = resolveTrackingTemporalReplay([candidate("00000000-0000-0000-0000-000000000011", 11), late], watermark);

    expect(replay?.lateEventIds).toEqual([late.eventLocationId]);
    expect(replay?.since.getTime()).toBe(late.occurredAt.getTime() - trackingReplayLookbackMs());
  });
});

function drainInBatches(candidates: TrackingCandidate[], batchSize: number): string[] {
  const processed: string[] = [];
  for (let index = 0; index < candidates.length; index += batchSize) {
    processed.push(...candidates.slice(index, index + batchSize).map(candidate => candidate.eventLocationId));
  }
  return processed;
}
