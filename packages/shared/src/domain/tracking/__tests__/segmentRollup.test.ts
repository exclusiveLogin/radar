/**
 * Сценарии проверки segment rollup (L2):
 * - общий сегмент из 3 треков → count=3, weight=3
 * - asOf фильтр уменьшает weight при историческом курсоре
 */
import { describe, expect, test } from "vitest";
import { buildTrackEdges } from "../flow/buildTrackEdges";
import { rollupSegmentCounts } from "../flow/rollupSegmentCounts";
import { filterEdgesByAsOf } from "../flow/applyAsOfFilter";
import type { TrajectoryNode } from "../types";

function makeNode(
  id: string,
  placeId: string | null,
  lat: number,
  lon: number,
  occurredAt: string,
): TrajectoryNode {
  return {
    id,
    trackId: "track-1",
    seq: 0,
    occurredAt: new Date(occurredAt),
    lat,
    lon,
    placeId,
    mode: "correct",
    kalmanState: null,
    sourceRefs: [],
  };
}

describe("segment rollup", () => {
  const placeA = "place-aaa-1111";
  const placeB = "place-bbb-2222";
  const placeC = "place-ccc-3333";

  const nodesTrack1: TrajectoryNode[] = [
    makeNode("n1", placeA, 50.0, 36.0, "2024-06-01T10:00:00Z"),
    makeNode("n2", placeB, 50.5, 36.5, "2024-06-01T10:30:00Z"),
  ];

  const nodesTrack2: TrajectoryNode[] = [
    makeNode("n3", placeA, 50.0, 36.0, "2024-06-01T11:00:00Z"),
    makeNode("n4", placeB, 50.5, 36.5, "2024-06-01T11:30:00Z"),
    makeNode("n5", placeC, 51.0, 37.0, "2024-06-01T12:00:00Z"),
  ];

  const nodesTrack3: TrajectoryNode[] = [
    makeNode("n6", placeA, 50.0, 36.0, "2024-06-01T12:30:00Z"),
    makeNode("n7", placeB, 50.5, 36.5, "2024-06-01T13:00:00Z"),
  ];

  test("общий сегмент A→B из 3 треков → count=3, weight=3", () => {
    const edges = [
      ...buildTrackEdges(nodesTrack1, "track-1", "uav"),
      ...buildTrackEdges(nodesTrack2, "track-2", "uav"),
      ...buildTrackEdges(nodesTrack3, "track-3", "uav"),
    ];

    const rollup = rollupSegmentCounts(edges);
    const segAB = rollup.find(
      s => s.fromPlaceKey === placeA && s.toPlaceKey === placeB,
    );

    expect(segAB).toBeDefined();
    expect(segAB!.count).toBe(3);
    expect(segAB!.weight).toBe(3);
  });

  test("сегмент B→C только из 1 трека → count=1", () => {
    const edges = [
      ...buildTrackEdges(nodesTrack1, "track-1", "uav"),
      ...buildTrackEdges(nodesTrack2, "track-2", "uav"),
    ];

    const rollup = rollupSegmentCounts(edges);
    const segBC = rollup.find(
      s => s.fromPlaceKey === placeB && s.toPlaceKey === placeC,
    );
    expect(segBC?.count).toBe(1);
  });

  test("asOf=11:00 исключает трек3 → weight=2 для A→B", () => {
    const asOf = new Date("2024-06-01T11:59:00Z");
    const edges = [
      ...buildTrackEdges(nodesTrack1, "track-1", "uav"),
      ...buildTrackEdges(nodesTrack2, "track-2", "uav"),
      ...buildTrackEdges(nodesTrack3, "track-3", "uav"),
    ];

    const filtered = filterEdgesByAsOf(edges, asOf);
    const rollup = rollupSegmentCounts(filtered);
    const segAB = rollup.find(
      s => s.fromPlaceKey === placeA && s.toPlaceKey === placeB,
    );

    // track3 nodes at 12:30 и 13:00 — все позже asOf
    expect(segAB!.count).toBe(2);
  });

  test("minCount=2 исключает редкие сегменты", () => {
    const edges = [
      ...buildTrackEdges(nodesTrack2, "track-2", "uav"),
    ];
    const rollup = rollupSegmentCounts(edges, { minCount: 2 });
    expect(rollup).toHaveLength(0);
  });
});
