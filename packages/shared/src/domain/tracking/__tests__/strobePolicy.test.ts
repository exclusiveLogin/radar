import { describe, expect, test } from "vitest";
import {
  belongsToTrackingStrobe,
  compareTrackingCandidates,
  createTrackingStrobeBounds,
  isTrackingStrobeReady,
} from "../strobePolicy";

const MINUTE = 60_000;
const FIRST_AT = new Date(Date.UTC(2026, 6, 30, 12));

describe("tracking strobe policy", () => {
  test("does not extend the fixed event-time boundary", () => {
    const bounds = createTrackingStrobeBounds(FIRST_AT, { maxWindowMs: 20 * MINUTE });

    expect(bounds.closesAt.getTime()).toBe(FIRST_AT.getTime() + 20 * MINUTE);
    expect(belongsToTrackingStrobe({ occurredAt: new Date(FIRST_AT.getTime() + 20 * MINUTE) }, bounds)).toBe(true);
    expect(belongsToTrackingStrobe({ occurredAt: new Date(FIRST_AT.getTime() + 20 * MINUTE + 1) }, bounds)).toBe(false);
    expect(isTrackingStrobeReady(bounds, new Date(FIRST_AT.getTime() + 20 * MINUTE))).toBe(false);
    expect(isTrackingStrobeReady(bounds, new Date(FIRST_AT.getTime() + 20 * MINUTE + 1))).toBe(true);
  });

  test("uses occurredAt and id as stable winner fallback", () => {
    const earlier = {
      occurredAt: FIRST_AT,
      eventLocationId: "00000000-0000-0000-0000-000000000001",
    };
    const later = {
      occurredAt: new Date(FIRST_AT.getTime() + MINUTE),
      eventLocationId: "00000000-0000-0000-0000-000000000000",
    };
    const equalTimeAfter = { ...earlier, eventLocationId: "00000000-0000-0000-0000-000000000002" };

    expect(compareTrackingCandidates(earlier, later)).toBeLessThan(0);
    expect(compareTrackingCandidates(earlier, equalTimeAfter)).toBeLessThan(0);
  });
});
