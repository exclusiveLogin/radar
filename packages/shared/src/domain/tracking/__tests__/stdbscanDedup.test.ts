/**
 * Сценарии проверки ST-DBSCAN dedup:
 * - 3 канала об одном событии → 1 winner (argmin sigma)
 * - noise точки проходят без изменений
 * - кластеры из разных временных окон → отдельные winners
 */
import { describe, expect, test } from "vitest";
import { stdbscanDedup } from "../stdbscan/stdbscanDedup";
import type { TrackingCandidate } from "../types";

function makeCandidate(
  id: string,
  lat: number,
  lon: number,
  occurredAt: string,
  precision: string,
  trust = 0.8,
): TrackingCandidate {
  return {
    eventLocationId: id,
    parsedEventId: `pe-${id}`,
    occurredAt: new Date(occurredAt),
    lat,
    lon,
    placeId: null,
    precision,
    trust,
    eventType: "fixation",
    eventCategory: null,
    affectsKinematics: true,
    isFrontRegion: false,
    threatProfile: "uav",
    mode: "correct",
    sourceRefs: [{ eventLocationId: id }],
  };
}

const PARAMS = {
  epsilonSpatialM: 8_000,
  epsilonTemporalMs: 15 * 60 * 1000, // 15 мин
  minPts: 2,
};

describe("ST-DBSCAN dedup", () => {
  test("3 канала об одном событии → 1 winner с coords (min sigma)", () => {
    const candidates = [
      makeCandidate("c1", 49.99, 36.22, "2024-06-01T10:00:00Z", "region"),   // sigma 50000
      makeCandidate("c2", 50.0, 36.2, "2024-06-01T10:03:00Z", "district"),   // sigma 8000
      makeCandidate("c3", 50.01, 36.18, "2024-06-01T10:05:00Z", "city"),     // sigma 800 — winner
    ];

    const { deduplicated, collapsedCount } = stdbscanDedup(candidates, PARAMS);

    expect(deduplicated).toHaveLength(1);
    expect(collapsedCount).toBe(2);
    // Winner должен быть точечным (city precision)
    expect(deduplicated[0].precision).toBe("city");
    // Все sourceRefs слиты в winner
    expect(deduplicated[0].sourceRefs.length).toBe(3);
  });

  test("одиночная noise точка проходит без изменений", () => {
    const candidates = [
      makeCandidate("solo", 50.0, 36.0, "2024-06-01T10:00:00Z", "city"),
    ];
    const { deduplicated, collapsedCount } = stdbscanDedup(candidates, PARAMS);
    expect(deduplicated).toHaveLength(1);
    expect(collapsedCount).toBe(0);
  });

  test("точки в разных временных окнах → 2 отдельных кандидата", () => {
    const candidates = [
      makeCandidate("a1", 50.0, 36.0, "2024-06-01T10:00:00Z", "city"),
      makeCandidate("a2", 50.01, 36.01, "2024-06-01T10:05:00Z", "city"),  // в окне ε_t
      makeCandidate("b1", 50.0, 36.0, "2024-06-01T11:00:00Z", "city"),  // вне ε_t
      makeCandidate("b2", 50.01, 36.01, "2024-06-01T11:05:00Z", "city"),
    ];
    const { deduplicated } = stdbscanDedup(candidates, PARAMS);
    // Два кластера → два winners
    expect(deduplicated).toHaveLength(2);
  });

  test("пустой массив → пустой результат", () => {
    const { deduplicated, collapsedCount } = stdbscanDedup([], PARAMS);
    expect(deduplicated).toHaveLength(0);
    expect(collapsedCount).toBe(0);
  });

  test("выход сортирован по occurredAt", () => {
    const candidates = [
      makeCandidate("z1", 50.0, 36.0, "2024-06-01T12:00:00Z", "city"),
      makeCandidate("z2", 51.0, 37.0, "2024-06-01T10:00:00Z", "city"),
      makeCandidate("z3", 52.0, 38.0, "2024-06-01T11:00:00Z", "city"),
    ];
    const { deduplicated } = stdbscanDedup(candidates, PARAMS);
    const times = deduplicated.map(c => c.occurredAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
