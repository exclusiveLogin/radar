import { describe, expect, test } from "vitest";
import { stdbscanDedup } from "../stdbscan/stdbscanDedup";
import { pickAssignableFromDedup, resolvePendingConsumedAfterDedup } from "../stdbscan/dedupGraph";
import type { TrackingCandidate } from "../../types";

function makeCandidate(
  id: string,
  lat: number,
  lon: number,
  ms: number,
  precision = "coords",
): TrackingCandidate {
  return {
    eventLocationId: id,
    parsedEventId: id,
    occurredAt: new Date(ms),
    lat,
    lon,
    placeId: null,
    precision,
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

const PARAMS = {
  epsilonSpatialM: 5000,
  epsilonTemporalMs: 20 * 60 * 1000,
  minPts: 2,
};

describe("dedupGraph", () => {
  test("pickAssignable: дубль pending схлопывается в consumed якорь", () => {
    const anchor = makeCandidate("a1", 50, 36, 0, "coords");
    const pending = makeCandidate("p1", 50.001, 36.001, 60_000, "city");
    const pendingIds = new Set(["p1"]);

    const { deduplicated, collapsedCount } = stdbscanDedup([anchor, pending], PARAMS);
    expect(collapsedCount).toBe(1);
    expect(pickAssignableFromDedup(deduplicated, pendingIds)).toHaveLength(0);
  });

  test("pickAssignable: новый pending winner проходит в assign", () => {
    const anchor = makeCandidate("a1", 50, 36, 0);
    const pending = makeCandidate("p1", 51, 37, 60_000);
    const pendingIds = new Set(["p1"]);

    const { deduplicated } = stdbscanDedup([anchor, pending], PARAMS);
    const assignable = pickAssignableFromDedup(deduplicated, pendingIds);
    expect(assignable).toHaveLength(1);
    expect(assignable[0]?.eventLocationId).toBe("p1");
  });

  test("resolvePendingConsumed: chunk + схлопнутые вне chunk", () => {
    const a = makeCandidate("p1", 50, 36, 0);
    const b = makeCandidate("p2", 50.001, 36.001, 60_000, "city");
    const c = makeCandidate("p3", 52, 38, 120_000);
    const fullPending = new Set(["p1", "p2", "p3"]);
    const chunk = new Set(["p1"]);
    const { deduplicated } = stdbscanDedup([a, b, c], PARAMS);
    const winners = new Set(deduplicated.map(x => x.eventLocationId));
    const consumed = resolvePendingConsumedAfterDedup(fullPending, chunk, winners);
    expect(consumed).toContain("p1");
    expect(consumed).toContain("p2");
    expect(consumed).not.toContain("p3");
  });
});
