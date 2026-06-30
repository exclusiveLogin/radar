import { describe, expect, it } from "vitest";
import { resolveTrackingPipelineStatus } from "../resolvePipelineStatus";

describe("resolveTrackingPipelineStatus", () => {
  it("disabled", () => {
    const s = resolveTrackingPipelineStatus({
      enabled: false,
      paused: false,
      activeRun: null,
      lastRun: null,
    });
    expect(s.code).toBe("disabled");
    expect(s.label).toBe("Выключен");
  });

  it("paused by control", () => {
    const s = resolveTrackingPipelineStatus({
      enabled: true,
      paused: true,
      activeRun: { status: "running" },
      lastRun: null,
    });
    expect(s.code).toBe("paused");
  });

  it("running with stage", () => {
    const s = resolveTrackingPipelineStatus({
      enabled: true,
      paused: false,
      activeRun: { status: "running", stats: { stage: "assign" } },
      lastRun: null,
    });
    expect(s.code).toBe("running");
    expect(s.detail).toContain("assign");
  });

  it("running with legacy stage done shows between ticks", () => {
    const s = resolveTrackingPipelineStatus({
      enabled: true,
      paused: false,
      activeRun: { status: "running", stats: { stage: "done", pendingCandidates: 8332 } },
      lastRun: null,
    });
    expect(s.code).toBe("running");
    expect(s.detail).toContain("Между тиками");
    expect(s.detail).not.toContain("Стадия: done");
  });

  it("waiting when remaining > 0", () => {
    const s = resolveTrackingPipelineStatus({
      enabled: true,
      paused: false,
      activeRun: null,
      lastRun: { status: "completed" },
      remainingCandidates: 42,
    });
    expect(s.code).toBe("waiting");
    expect(s.remainingCandidates).toBe(42);
  });

  it("completed idle when no remaining", () => {
    const s = resolveTrackingPipelineStatus({
      enabled: true,
      paused: false,
      activeRun: null,
      lastRun: { status: "completed" },
      remainingCandidates: 0,
    });
    expect(s.code).toBe("completed");
    expect(s.label).toBe("Простой");
  });

  it("failed from lastRun", () => {
    const s = resolveTrackingPipelineStatus({
      enabled: true,
      paused: false,
      activeRun: null,
      lastRun: { status: "failed", error: "boom" },
      remainingCandidates: 0,
    });
    expect(s.code).toBe("failed");
    expect(s.detail).toBe("boom");
  });
});
