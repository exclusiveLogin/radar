import { describe, expect, it } from "vitest";
import {
  buildBackfillJobProgress,
  computeBackfillPercentApprox,
  mergeBackfillPercentMonotonic,
  pickFurtherCheckpointOffsetId,
  readBackfillRoundRobinSlice,
  resolveBackfillIdBounds,
  resolveBackfillRoundRobinSlice,
  withBackfillRoundRobinSlice,
} from "./backfillProgress";

describe("backfillProgress", () => {
  const params = {
    preflight: {
      minId: "100",
      maxId: "200",
      minPostedAt: "2020-01-01T00:00:00.000Z",
      maxPostedAt: "2024-01-01T00:00:00.000Z",
      probedAt: "2024-06-01T00:00:00.000Z",
    },
  };

  it("resolveBackfillIdBounds from preflight", () => {
    expect(resolveBackfillIdBounds("full_history", params)).toEqual({
      minId: "100",
      maxId: "200",
    });
  });

  it("computeBackfillPercentApprox at midpoint (newest→oldest)", () => {
    expect(computeBackfillPercentApprox("full_history", params, "150")).toBe(50);
  });

  it("computeBackfillPercentApprox newest-first: max=0%, min=100%", () => {
    expect(computeBackfillPercentApprox("full_history", params, "200")).toBe(0);
    expect(computeBackfillPercentApprox("full_history", params, "100")).toBe(100);
  });

  it("computeBackfillPercentApprox oldest-first when streamReverse", () => {
    const oldFirst = { ...params, streamReverse: true };
    expect(computeBackfillPercentApprox("full_history", oldFirst, "100")).toBe(0);
    expect(computeBackfillPercentApprox("full_history", oldFirst, "200")).toBe(100);
  });

  it("mergeBackfillPercentMonotonic keeps max", () => {
    expect(mergeBackfillPercentMonotonic(12, 3)).toBe(12);
    expect(pickFurtherCheckpointOffsetId(params, "180", "150")).toBe("150");
  });

  it("buildBackfillJobProgress includes bounds and percent", () => {
    const progress = buildBackfillJobProgress({
      strategy: "full_history",
      params,
      stats: { inserted: 1, duplicates: 0, parsed: 0 },
      checkpointOffsetId: "150",
      checkpointPostedAt: "2022-01-01T00:00:00.000Z",
    });
    expect(progress.boundsMinId).toBe("100");
    expect(progress.percentApprox).toBe(50);
  });

  it("roundRobinSlice read/write and resolve for UI", () => {
    const withActive = withBackfillRoundRobinSlice(params, "active");
    expect(readBackfillRoundRobinSlice(withActive)).toBe("active");
    expect(resolveBackfillRoundRobinSlice("running", withActive)).toBe("active");
    expect(resolveBackfillRoundRobinSlice("completed", withActive)).toBeNull();
    const cleared = withBackfillRoundRobinSlice(withActive, null);
    expect(readBackfillRoundRobinSlice(cleared)).toBeNull();
  });
});
