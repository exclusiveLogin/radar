import { describe, expect, test } from "vitest";
import { createPlaceGravityIndex } from "../flow/placeGravityIndex";
import { zoneKeyForCandidate, encodeGeohash } from "../flow/geohashZoneKey";
import { buildPlaceGravityIndexFromCandidates } from "../flow/buildPlaceGravityIndex";
import type { TrackingCandidate } from "../types";

function cand(partial: Partial<TrackingCandidate> & Pick<TrackingCandidate, "eventLocationId" | "lat" | "lon">): TrackingCandidate {
  return {
    parsedEventId: partial.eventLocationId,
    occurredAt: partial.occurredAt ?? new Date("2026-01-01T10:00:00Z"),
    precision: "coords",
    trust: 1,
    eventType: "uav",
    eventCategory: null,
    affectsKinematics: true,
    isFrontRegion: true,
    threatProfile: "uav",
    mode: "correct",
    sourceRefs: [],
    placeId: partial.placeId ?? null,
    ...partial,
  };
}

describe("placeGravityIndex", () => {
  test("гибридный ключ: place_id приоритетнее geohash", () => {
    expect(zoneKeyForCandidate("p1", 50, 30, 5)).toBe("place:p1");
    expect(zoneKeyForCandidate(null, 50.1, 30.2, 5)).toMatch(/^geo:/);
  });

  test("encodeGeohash стабилен", () => {
    const h = encodeGeohash(55.75, 37.62, 5);
    expect(h.length).toBe(5);
    expect(encodeGeohash(55.75, 37.62, 5)).toBe(h);
  });

  test("recordCluster накапливает массу", () => {
    const idx = createPlaceGravityIndex();
    idx.recordCluster("place:x", 3, 50, 30);
    idx.recordCluster("place:x", 2, 50, 30);
    expect(idx.lookup("place:x")?.mass).toBe(5);
  });
});

describe("stdbscanMagnetize", () => {
  test("кластер: winner по seedScore, clusterMass > одной точки", async () => {
    const { stdbscanMagnetize } = await import("../stdbscan/stdbscanMagnetize");
    const t = new Date("2026-01-01T10:00:00Z");
    const a = cand({
      eventLocationId: "a",
      lat: 50,
      lon: 30,
      occurredAt: t,
      precision: "city",
    });
    const b = cand({
      eventLocationId: "b",
      lat: 50.001,
      lon: 30.001,
      occurredAt: t,
      precision: "coords",
    });
    const { magnetism, candidates } = stdbscanMagnetize([a, b], {
      epsilonSpatialM: 5000,
      epsilonTemporalMs: 60_000,
      minPts: 2,
    });
    expect(candidates).toHaveLength(2);
    expect(magnetism.get("b")?.isWinner).toBe(true);
    expect(magnetism.get("a")?.isWinner).toBe(false);
    expect(magnetism.get("b")!.clusterMass).toBeGreaterThan(magnetism.get("b")!.seedScore);
  });
});

describe("buildPlaceGravityIndexFromCandidates", () => {
  test("агрегирует winner-облака по зонам", () => {
    const t = new Date("2026-01-01T10:00:00Z");
    const a = cand({ eventLocationId: "a", lat: 50, lon: 30, occurredAt: t, placeId: "pl-1" });
    const b = cand({ eventLocationId: "b", lat: 50.001, lon: 30.001, occurredAt: t, placeId: "pl-1" });
    const idx = buildPlaceGravityIndexFromCandidates([a, b]);
    expect(idx.lookup("place:pl-1")?.mass).toBeGreaterThan(0);
  });
});
