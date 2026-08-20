import { describe, expect, test } from "vitest";
import {
  belongsToTrackingStrobe,
  compareTrackingCandidates,
  createTrackingStrobeBounds,
  isTrackingStrobeReady,
} from "../strobePolicy";

const MINUTE = 60_000;
const WINDOW = 20 * MINUTE;
/** 12:07 → бин [12:00, 12:20) при окне 20 мин от epoch-aligned сетки. */
const POINT_AT = new Date(Date.UTC(2026, 6, 30, 12, 7));

describe("tracking strobe policy", () => {
  test("aligns bounds to a deterministic floor(t/window) grid", () => {
    const bounds = createTrackingStrobeBounds(POINT_AT, { maxWindowMs: WINDOW });
    const expectedStart = Math.floor(POINT_AT.getTime() / WINDOW) * WINDOW;

    expect(bounds.firstOccurredAt.getTime()).toBe(expectedStart);
    expect(bounds.closesAt.getTime()).toBe(expectedStart + WINDOW);
    expect(belongsToTrackingStrobe({ occurredAt: bounds.firstOccurredAt }, bounds)).toBe(true);
    expect(belongsToTrackingStrobe({ occurredAt: new Date(bounds.closesAt.getTime() - 1) }, bounds)).toBe(true);
    expect(belongsToTrackingStrobe({ occurredAt: bounds.closesAt }, bounds)).toBe(false);
    expect(isTrackingStrobeReady(bounds, bounds.closesAt)).toBe(true);
    expect(isTrackingStrobeReady(bounds, new Date(bounds.closesAt.getTime() - 1))).toBe(false);
  });

  test("same bin for any point inside the window regardless of arrival order", () => {
    const early = new Date(Date.UTC(2026, 6, 30, 12, 1));
    const late = new Date(Date.UTC(2026, 6, 30, 12, 19));
    const earlyBounds = createTrackingStrobeBounds(early, { maxWindowMs: WINDOW });
    const lateBounds = createTrackingStrobeBounds(late, { maxWindowMs: WINDOW });

    expect(earlyBounds.firstOccurredAt.getTime()).toBe(lateBounds.firstOccurredAt.getTime());
    expect(earlyBounds.closesAt.getTime()).toBe(lateBounds.closesAt.getTime());
  });

  test("uses occurredAt and id as stable winner fallback", () => {
    const earlier = {
      occurredAt: POINT_AT,
      eventLocationId: "00000000-0000-0000-0000-000000000001",
    };
    const later = {
      occurredAt: new Date(POINT_AT.getTime() + MINUTE),
      eventLocationId: "00000000-0000-0000-0000-000000000000",
    };
    const equalTimeAfter = { ...earlier, eventLocationId: "00000000-0000-0000-0000-000000000002" };

    expect(compareTrackingCandidates(earlier, later)).toBeLessThan(0);
    expect(compareTrackingCandidates(earlier, equalTimeAfter)).toBeLessThan(0);
  });
});
