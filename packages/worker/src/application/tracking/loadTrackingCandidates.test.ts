/**
 * ---
 * layer: worker/application
 * domain: tracking
 * purpose: Контракт bounded SQL-page для одного tracking tick.
 *          Это не нагрузочный или PostgreSQL integration test.
 * ---
 */
import { describe, expect, test } from "vitest";
import type { DataSource } from "typeorm";
import { loadPendingTrackingCandidates } from "./loadTrackingCandidates.js";

describe("loadPendingTrackingCandidates", () => {
  test("uses one bounded pending-page query instead of loading the full queue", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const ds = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return [];
      },
    } as unknown as DataSource;
    const until = new Date("2026-07-31T12:00:00.000Z");

    await expect(loadPendingTrackingCandidates(ds, { until, limit: 500 })).resolves.toEqual([]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("LIMIT $2");
    expect(calls[0]?.sql).toContain("NOT EXISTS");
    expect(calls[0]?.params).toEqual([until.toISOString(), 500]);
  });
});
