import { describe, expect, test } from "vitest";
import {
  buildCorridorFromCandidates,
  corridorMaxSpatialM,
  temporalAssignSlices,
} from "../flow/buildCorridorFromCandidates";
import { resolveProfileKinematics } from "../profileKinematics";
import { resolveFlowBearingDeg, DEFAULT_FLOW_ALIGNMENT } from "../flowAlignment";
import { corridorBearingDeg } from "../flow/corridorRollupIndex";
import type { TrackingCandidate } from "../types";

function cand(
  id: string,
  placeId: string,
  lat: number,
  lon: number,
  atMs: number,
): TrackingCandidate {
  return {
    eventLocationId: id,
    occurredAt: new Date(atMs),
    lat,
    lon,
    placeId,
    threatProfile: "uav",
    eventType: "fixation",
    mode: "correct",
    precision: "city",
    trust: 0.8,
    sourceRefs: [],
    nearestFrontLat: 50,
    nearestFrontLon: 36,
  };
}

describe("buildCorridorFromCandidates", () => {
  test("ранние события видят коридор, построенный из поздних пар в потоке", () => {
    // Эмпирика: пограничье → промежуточный → глубина (севернее)
    const t0 = Date.parse("2026-01-01T10:00:00Z");
    // Цепочка с шагом ~60 км / 15 мин (в пределах v_max·Δt + ε_spatial)
    const candidates = [
      cand("a", "belgorod", 50.6, 36.6, t0),
      cand("b", "kursk", 50.95, 36.35, t0 + 15 * 60_000),
      cand("c", "oryol", 51.3, 36.1, t0 + 30 * 60_000),
      cand("d", "tula", 51.65, 37.0, t0 + 45 * 60_000),
    ];

    const corridor = buildCorridorFromCandidates(candidates);

    const belToKursk = corridor.lookup("belgorod", "kursk", "uav");
    expect(belToKursk?.count).toBe(1);

    // Событие «oryol» может использовать B-коридор belgorod→kursk ещё до assign
    const entry = corridor.lookup("belgorod", "kursk", "uav")!;
    const bearing = resolveFlowBearingDeg(
      52.5,
      36.5,
      50,
      36,
      { count: entry.count, bearingDeg: corridorBearingDeg(entry) },
      DEFAULT_FLOW_ALIGNMENT,
    );
    expect(bearing).not.toBeNull();
  });

  test("не записывает ребро при gap больше maxGapMs", () => {
    const t0 = Date.parse("2026-01-01T10:00:00Z");
    const gapMs = 4 * 60 * 60 * 1000;
    const candidates = [
      cand("a", "p1", 50, 36, t0),
      cand("b", "p2", 51, 37, t0 + gapMs),
    ];
    const corridor = buildCorridorFromCandidates(candidates, {
      maxGapMs: { uav: 3 * 60 * 60 * 1000 },
    });
    expect(corridor.lookup("p1", "p2", "uav")).toBeNull();
  });

  test("не склеивает далёкие места в одном temporal окне (anti-hub)", () => {
    const t0 = Date.parse("2026-01-01T10:00:00Z");
    const candidates = [
      cand("a", "luhansk", 48.57, 39.3, t0),
      cand("b", "rostov", 47.23, 39.72, t0 + 15 * 60_000),
    ];
    const corridor = buildCorridorFromCandidates(candidates);
    // ~150 км за 15 мин — выше v_max·Δt + ε_spatial для UAV
    expect(corridor.lookup("luhansk", "rostov", "uav")).toBeNull();
  });

  test("corridorMaxSpatialM — физический потолок", () => {
    const kin = resolveProfileKinematics("uav");
    const cap = corridorMaxSpatialM(20 * 60_000, kin);
    expect(cap).toBeLessThan(250_000);
    expect(cap).toBeGreaterThan(50_000);
  });

  test("temporalAssignSlices группирует по maxSpanMs", () => {
    const t0 = Date.parse("2026-01-01T10:00:00Z");
    const candidates = [
      cand("a", "p1", 50, 36, t0),
      cand("b", "p2", 51, 37, t0 + 10 * 60_000),
      cand("c", "p3", 52, 38, t0 + 40 * 60_000),
    ];
    const slices = temporalAssignSlices(candidates, 20 * 60_000);
    expect(slices).toHaveLength(2);
    expect(slices[0]!.map(c => c.eventLocationId)).toEqual(["a", "b"]);
    expect(slices[1]!.map(c => c.eventLocationId)).toEqual(["c"]);
  });
});
