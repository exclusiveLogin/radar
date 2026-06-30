import { describe, expect, test } from "vitest";
import { applyMagnetWeights, DEFAULT_MAGNET_COST_WEIGHTS } from "../applyMagnetWeights";
import type { MagnetismEntry } from "../stdbscan/stdbscanMagnetize";

function entry(magnetism: number): MagnetismEntry {
  return { clusterId: 1, magnetism, isWinner: true, clusterMass: magnetism, seedScore: magnetism };
}

describe("applyMagnetWeights", () => {
  test("снижает cost при высоком магнетизме", () => {
    const index = new Map([["a", entry(2)]]);
    const base = 100;
    const weighted = applyMagnetWeights(base, "a", index, { wMag: 1, wFlow: 0 });
    expect(weighted).toBeLessThan(base);
    expect(weighted).toBeCloseTo(100 / 3, 5);
  });

  test("forward align дополнительно снижает cost", () => {
    const index = new Map([["a", entry(1)]]);
    const w = { wMag: 1, wFlow: 1 };
    const noAlign = applyMagnetWeights(100, "a", index, w, 0);
    const align = applyMagnetWeights(100, "a", index, w, 1);
    expect(align).toBeLessThan(noAlign);
  });

  test("без записи в индексе — baseCost без изменений по магниту", () => {
    const cost = applyMagnetWeights(50, "missing", new Map(), DEFAULT_MAGNET_COST_WEIGHTS, 0);
    expect(cost).toBe(50);
  });
});
