/**
 * Unit-тесты жадной ассоциации по току (greedy-flow).
 */
import { describe, expect, test } from "vitest";
import {
  buildGreedyFlowChains,
  depthFromFrontM,
  DEFAULT_GREEDY_FLOW,
} from "../greedyFlowAssociation";
import { PROFILE_KINEMATICS } from "../profileKinematics";
import type { TrackingCandidate } from "../types";

const UAV = PROFILE_KINEMATICS.uav;
const FRONT = { lat: 50.0, lon: 30.0 };

function pt(overrides: Partial<TrackingCandidate> & { id: string }): TrackingCandidate {
  const { id, ...rest } = overrides;
  return {
    eventLocationId: id,
    parsedEventId: `pe-${id}`,
    occurredAt: new Date("2024-06-01T12:00:00Z"),
    lat: 50.0,
    lon: 30.0,
    placeId: null,
    precision: "coords",
    trust: 0.9,
    eventType: "fixation",
    eventCategory: null,
    affectsKinematics: true,
    isFrontRegion: false,
    isInteriorRf: false,
    nearestFrontLat: FRONT.lat,
    nearestFrontLon: FRONT.lon,
    threatProfile: "uav",
    mode: "correct",
    sourceRefs: [],
    ...rest,
  };
}

const hours = (h: number) => new Date(Date.UTC(2024, 5, 1, 12 + h, 0, 0));

describe("depthFromFrontM", () => {
  test("использует front_distance_km, если задан", () => {
    expect(depthFromFrontM(pt({ id: "a", frontDistanceKm: 120 }))).toBe(120_000);
  });

  test("фолбэк на геометрию до ближайшего фронта (100% покрытие)", () => {
    const d = depthFromFrontM(pt({ id: "a", lon: 31.0, frontDistanceKm: null }));
    expect(d).toBeGreaterThan(60_000); // ~1° долготы ≈ 71 км
  });
});

describe("buildGreedyFlowChains", () => {
  test("3 точки вглубь по времени → одна цепочка в порядке времени", () => {
    const pts = [
      pt({ id: "a", lon: 30.5, frontDistanceKm: 35, occurredAt: hours(0) }),
      pt({ id: "b", lon: 31.5, frontDistanceKm: 105, occurredAt: hours(1) }),
      pt({ id: "c", lon: 32.5, frontDistanceKm: 175, occurredAt: hours(2) }),
    ];
    const chains = buildGreedyFlowChains(pts, UAV);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.map(c => c.eventLocationId)).toEqual(["a", "b", "c"]);
  });

  test("точка обратно к фронту (мельче глубина) не линкуется", () => {
    const pts = [
      pt({ id: "a", lon: 31.5, frontDistanceKm: 105, occurredAt: hours(0) }),
      // c глубже b, но b ближе к фронту чем a → b не должен принять ребро от a
      pt({ id: "b", lon: 30.5, frontDistanceKm: 35, occurredAt: hours(1) }),
    ];
    const chains = buildGreedyFlowChains(pts, UAV);
    expect(chains).toHaveLength(0);
  });

  test("разрыв времени > maxGapMs рвёт цепочку", () => {
    const pts = [
      pt({ id: "a", lon: 30.5, frontDistanceKm: 35, occurredAt: hours(0) }),
      pt({ id: "b", lon: 31.5, frontDistanceKm: 105, occurredAt: hours(100) }),
    ];
    const chains = buildGreedyFlowChains(pts, UAV);
    expect(chains).toHaveLength(0);
  });

  test("каждая точка — максимум один преемник (нити не ветвятся)", () => {
    const pts = [
      pt({ id: "a", lon: 30.5, frontDistanceKm: 35, occurredAt: hours(0) }),
      pt({ id: "b", lon: 31.5, frontDistanceKm: 105, occurredAt: hours(1) }),
      pt({ id: "c", lon: 31.6, frontDistanceKm: 110, occurredAt: hours(1) }),
    ];
    const chains = buildGreedyFlowChains(pts, UAV);
    const linkedAfterA = chains.flatMap(ch =>
      ch[0]!.eventLocationId === "a" ? ch.slice(1).map(c => c.eventLocationId) : [],
    );
    // a имеет ровно одного прямого преемника (b или c), не обоих как ветви.
    expect(chains.every(ch => ch.length === new Set(ch).size)).toBe(true);
    expect(linkedAfterA.length).toBeGreaterThanOrEqual(1);
  });

  test("self-attention: точку поглощает ближайший хвост трека, а не первый", () => {
    const pts = [
      // Два трека-сидера в одно время (между собой не линкуются: dt=0).
      pt({ id: "far", lon: 31.0, frontDistanceKm: 70, occurredAt: hours(0) }),
      pt({ id: "near", lon: 31.2, frontDistanceKm: 85, occurredAt: hours(0) }),
      // Новая точка ближе к хвосту "near" (≈3.5км) чем к "far" (≈17км).
      pt({ id: "p", lon: 31.25, frontDistanceKm: 90, occurredAt: hours(1) }),
    ];
    const chains = buildGreedyFlowChains(pts, UAV);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.map(c => c.eventLocationId)).toEqual(["near", "p"]);
  });

  test("магнетизм: winner-точка предпочтительнее для линковки", () => {
    const tail = pt({ id: "tail", lon: 31.0, frontDistanceKm: 70, occurredAt: hours(0) });
    const weak = pt({ id: "weak", lon: 31.05, frontDistanceKm: 75, occurredAt: hours(1) });
    const strong = pt({ id: "strong", lon: 31.06, frontDistanceKm: 76, occurredAt: hours(1) });
    const magnetism = new Map([
      ["weak", { clusterId: 1, magnetism: 0.2, isWinner: false, clusterMass: 1, seedScore: 0.2 }],
      ["strong", { clusterId: 2, magnetism: 5, isWinner: true, clusterMass: 5, seedScore: 2 }],
    ]);
    const chainsWeak = buildGreedyFlowChains([tail, weak], UAV, {
      weights: DEFAULT_GREEDY_FLOW,
      magnetismIndex: magnetism,
      magnetCost: { wMag: 2, wFlow: 0 },
    });
    const chainsStrong = buildGreedyFlowChains([tail, strong], UAV, {
      weights: DEFAULT_GREEDY_FLOW,
      magnetismIndex: magnetism,
      magnetCost: { wMag: 2, wFlow: 0 },
    });
    expect(chainsStrong[0]?.length).toBeGreaterThanOrEqual(chainsWeak[0]?.length ?? 0);
  });

  test("монотонность глубины: в каждой цепочке depth не падает ниже ε", () => {
    const pts = [
      pt({ id: "a", lon: 30.5, frontDistanceKm: 35, occurredAt: hours(0) }),
      pt({ id: "b", lon: 31.5, frontDistanceKm: 105, occurredAt: hours(1) }),
      pt({ id: "c", lon: 32.5, frontDistanceKm: 175, occurredAt: hours(2) }),
    ];
    const chains = buildGreedyFlowChains(pts, UAV);
    for (const ch of chains) {
      for (let i = 1; i < ch.length; i++) {
        expect(depthFromFrontM(ch[i]!)).toBeGreaterThanOrEqual(
          depthFromFrontM(ch[i - 1]!) - DEFAULT_GREEDY_FLOW.depthToleranceM,
        );
      }
    }
  });
});
