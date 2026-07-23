import { describe, expect, test } from "vitest";
import {
  trackingPipelineConfigSchema,
  type TrackingCandidate,
} from "@radar/shared";
import { runTrackingResearchVariant } from "./trackingResearchHarness.js";

function candidate(
  eventLocationId: string,
  occurredAt: string,
  lon: number,
): TrackingCandidate {
  return {
    eventLocationId,
    parsedEventId: eventLocationId,
    occurredAt: new Date(occurredAt),
    lat: 50,
    lon,
    placeId: null,
    precision: "coords",
    trust: 1,
    eventType: "warning",
    eventCategory: null,
    affectsKinematics: true,
    isFrontRegion: false,
    isInteriorRf: true,
    frontDistanceKm: lon * 10,
    nearestFrontLat: 49,
    nearestFrontLon: 30,
    threatProfile: "uav",
    mode: "correct",
    sourceRefs: [{ eventLocationId, parsedEventId: eventLocationId }],
  };
}

describe("tracking research harness", () => {
  test("runs isolated variants without changing empirical candidates", () => {
    const candidates = [
      candidate("a", "2026-01-01T00:00:00.000Z", 31),
      candidate("b", "2026-01-01T00:30:00.000Z", 31.1),
      candidate("c", "2026-01-01T01:00:00.000Z", 31.2),
    ];
    const before = JSON.stringify(candidates);
    const config = trackingPipelineConfigSchema.parse({});

    const baseline = runTrackingResearchVariant(candidates, config, "baseline");
    const noDirection = runTrackingResearchVariant(
      candidates,
      config,
      "no-field-direction",
    );
    const repeated = runTrackingResearchVariant(candidates, config, "baseline");

    expect(JSON.stringify(candidates)).toBe(before);
    expect(baseline.preservation.missingEventLocationIds).toEqual([]);
    expect(noDirection.preservation.missingEventLocationIds).toEqual([]);
    expect(baseline.membership).toEqual(repeated.membership);
    expect(baseline.stats.field.vectors).not.toEqual(noDirection.stats.field.vectors);
  });
});
