/**
 * Сценарии проверки origin policy и termination policy.
 */
import { describe, expect, test } from "vitest";
import { isNearAnyOpenTrack, scoreSeedCandidate } from "../trackOriginPolicy";
import { checkTrackTermination } from "../trackTerminationPolicy";
import { PROFILE_KINEMATICS } from "../profileKinematics";
import type { TrackingCandidate } from "../types";

const UAV_KIN = PROFILE_KINEMATICS.uav;

function makeCandidate(
  overrides: Partial<TrackingCandidate> = {},
): TrackingCandidate {
  return {
    eventLocationId: "loc-1",
    parsedEventId: "pe-1",
    occurredAt: new Date("2024-06-01T12:00:00Z"),
    lat: 50.0,
    lon: 36.0,
    placeId: null,
    precision: "city",
    trust: 0.8,
    eventType: "fixation",
    eventCategory: null,
    affectsKinematics: true,
    isFrontRegion: false,
    threatProfile: "uav",
    mode: "correct",
    sourceRefs: [],
    ...overrides,
  };
}

describe("origin policy", () => {
  test("front_region boost даёт +100 к score", () => {
    const base = scoreSeedCandidate(makeCandidate({ isFrontRegion: false }));
    const boosted = scoreSeedCandidate(makeCandidate({ isFrontRegion: true }));
    expect(boosted - base).toBe(100);
  });

  test("кандидат далеко от open track → не блокируется", () => {
    const candidate = makeCandidate({ lat: 50.0, lon: 36.0 });
    const openTrack = {
      lastLat: 48.0, // ~220 km away
      lastLon: 36.0,
      lastAt: new Date("2024-06-01T11:50:00Z"),
      profile: "uav" as const,
    };
    expect(isNearAnyOpenTrack(candidate, [openTrack], UAV_KIN)).toBe(false);
  });

  test("кандидат близко к open track → блокируется (не стартует новый трек)", () => {
    const candidate = makeCandidate({
      lat: 50.001,
      lon: 36.001,
      occurredAt: new Date("2024-06-01T12:05:00Z"),
    });
    const openTrack = {
      lastLat: 50.0,
      lastLon: 36.0,
      lastAt: new Date("2024-06-01T12:00:00Z"),
      profile: "uav" as const,
    };
    expect(isNearAnyOpenTrack(candidate, [openTrack], UAV_KIN)).toBe(true);
  });

  test("open track слишком старый (gap > maxGapMs) → не блокирует", () => {
    const candidate = makeCandidate({
      lat: 50.001,
      lon: 36.001,
      occurredAt: new Date("2024-06-01T14:00:00Z"), // +2h
    });
    const openTrack = {
      lastLat: 50.0,
      lastLon: 36.0,
      lastAt: new Date("2024-06-01T12:00:00Z"),
      profile: "uav" as const,
    };
    expect(isNearAnyOpenTrack(candidate, [openTrack], UAV_KIN)).toBe(false);
  });
});

describe("termination policy", () => {
  test("трек в норме — не закрывается", () => {
    const result = checkTrackTermination({
      firstAt: new Date("2024-06-01T10:00:00Z"),
      currentAt: new Date("2024-06-01T11:00:00Z"), // 1 ч из 10 ч лимита UAV
      totalDistanceM: 50_000, // 50 км из 1600 км
      profile: UAV_KIN,
    });
    expect(result.shouldClose).toBe(false);
  });

  test("превышение maxTrackDurationMs → close:max_duration", () => {
    const result = checkTrackTermination({
      firstAt: new Date("2024-06-01T08:00:00Z"),
      currentAt: new Date("2024-06-01T19:00:00Z"), // 11 ч > 10 ч для UAV
      totalDistanceM: 100_000,
      profile: UAV_KIN,
    });
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe("max_duration");
  });

  test("превышение maxRangeFromOriginM → close:max_range", () => {
    const result = checkTrackTermination({
      firstAt: new Date("2024-06-01T10:00:00Z"),
      currentAt: new Date("2024-06-01T11:00:00Z"),
      totalDistanceM: 1_700_000, // 1700 км > 1600 км для UAV
      profile: UAV_KIN,
    });
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe("max_range");
  });

  test("rocket: допускает большой range", () => {
    const result = checkTrackTermination({
      firstAt: new Date("2024-06-01T10:00:00Z"),
      currentAt: new Date("2024-06-01T10:30:00Z"),
      totalDistanceM: 2_500_000, // 2500 км < 3000 км для rocket
      profile: PROFILE_KINEMATICS.rocket,
    });
    expect(result.shouldClose).toBe(false);
  });
});
