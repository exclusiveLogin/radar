import { describe, expect, test } from "vitest";
import {
  applyFlowAlignment,
  flowAlignmentCos,
  resolveFlowBearingDeg,
  DEFAULT_FLOW_ALIGNMENT,
} from "../flowAlignment";
import {
  createCorridorRollupIndex,
} from "../flow/corridorRollupIndex";
import {
  inManeuverLocus,
  maneuverToleranceM,
  sinCoefficientRho,
} from "../maneuverLocus";

describe("maneuverLocus", () => {
  test("ρ ≤ 1 в локусе", () => {
    const r = maneuverToleranceM(70, 3600, 5000);
    expect(inManeuverLocus(sinCoefficientRho(r * 0.5, r))).toBe(true);
    expect(inManeuverLocus(sinCoefficientRho(r * 1.5, r))).toBe(false);
  });

  test("r_доп растёт с dt", () => {
    const r1 = maneuverToleranceM(70, 60, 1000);
    const r2 = maneuverToleranceM(70, 3600, 1000);
    expect(r2).toBeGreaterThan(r1);
  });
});

describe("flowAlignment", () => {
  test("противоток увеличивает ρ'", () => {
    const rho = 0.5;
    const along = flowAlignmentCos(50, 36, 50.1, 36, 0);
    const against = flowAlignmentCos(50, 36, 49.9, 36, 0);
    const w = { ...DEFAULT_FLOW_ALIGNMENT, flowWeight: 0.2, counterFlowPenalty: 0.5 };
    const rhoAlong = applyFlowAlignment(rho, along, w);
    const rhoAgainst = applyFlowAlignment(rho, against, w);
    expect(rhoAgainst).toBeGreaterThan(rhoAlong);
  });

  test("multiplier=0 не смешивает коридор", () => {
    const bearing = resolveFlowBearingDeg(
      50,
      36,
      49,
      36,
      { count: 5, bearingDeg: 90 },
      { ...DEFAULT_FLOW_ALIGNMENT, flowEmpiricalMultiplier: 0 },
    );
    const onlyA = resolveFlowBearingDeg(50, 36, 49, 36, null, DEFAULT_FLOW_ALIGNMENT);
    expect(bearing).toBe(onlyA);
  });

  test("count×multiplier усиливает вклад B", () => {
    const idx = createCorridorRollupIndex();
    idx.recordPass("p1", "p2", 50, 36, 50.1, 36.1);
    idx.recordPass("p1", "p2", 50, 36, 50.1, 36.1);
    const entry = idx.lookup("p1", "p2")!;
    expect(entry.count).toBe(2);
    const weak = resolveFlowBearingDeg(
      50.05,
      36.05,
      49,
      36,
      { count: 1, bearingDeg: 90 },
      { ...DEFAULT_FLOW_ALIGNMENT, flowEmpiricalMultiplier: 1 },
    );
    const strong = resolveFlowBearingDeg(
      50.05,
      36.05,
      49,
      36,
      { count: 10, bearingDeg: 90 },
      { ...DEFAULT_FLOW_ALIGNMENT, flowEmpiricalMultiplier: 1 },
    );
    expect(weak).not.toBe(strong);
  });

  test("γ=0 не меняет ρ", () => {
    const off = { ...DEFAULT_FLOW_ALIGNMENT, flowWeight: 0, counterFlowPenalty: 0 };
    expect(applyFlowAlignment(0.8, -1, off)).toBe(0.8);
  });

  test("global directional bias смещает итоговый bearing", () => {
    const noGlobal = resolveFlowBearingDeg(
      50,
      36,
      49,
      36,
      null,
      { ...DEFAULT_FLOW_ALIGNMENT, globalDirectionWeight: 0, globalDirectionBearingDeg: null },
    )!;
    const withGlobal = resolveFlowBearingDeg(
      50,
      36,
      49,
      36,
      null,
      { ...DEFAULT_FLOW_ALIGNMENT, globalDirectionWeight: 1, globalDirectionBearingDeg: 90 },
    )!;
    expect(withGlobal).not.toBe(noGlobal);
    expect(withGlobal).toBeGreaterThan(noGlobal);
  });
});
