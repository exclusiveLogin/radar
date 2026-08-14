import { describe, expect, test } from "vitest";
import type { DataSource } from "typeorm";
import {
  trackingPipelineConfigSchema,
  type TrackingCandidate,
} from "@radar/shared";
import {
  resetTrackingStrobeTail,
  stageTrackingCandidates,
  type TrackingStrobe,
} from "./trackingStrobeRepository.js";

const strobe: TrackingStrobe = {
  id: "00000000-0000-0000-0000-000000000010",
  firstAt: new Date("2026-07-31T10:00:00.000Z"),
  closesAt: new Date("2026-07-31T10:20:00.000Z"),
  status: "open",
  winnerEventLocationIds: [],
  flowSnapshot: null,
};

describe("tracking strobe tail replay", () => {
  test("restores the immediately preceding FlowMap checkpoint", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const prefixSnapshot = { vectors: { "883": [1, 2] }, mass: { "883": 3 } };
    const ds = {
      transaction: async <T>(body: (manager: { query: Query }) => Promise<T>) =>
        body({
          query: async (sql: string, params?: unknown[]) => {
            calls.push({ sql, params });
            return sql.includes("SELECT flow_snapshot") ? [{ flow_snapshot: prefixSnapshot }] : [];
          },
        }),
    } as unknown as DataSource;

    await resetTrackingStrobeTail(ds, strobe);

    const stateReset = calls.find(call => call.sql.includes("UPDATE state_track_pipeline"));
    expect(stateReset?.params?.[2]).toBe(JSON.stringify(prefixSnapshot));
    expect(calls.some(call => call.sql.includes("DELETE FROM mat_track"))).toBe(true);
    expect(calls.some(call => call.sql.includes("winner_event_location_ids = '[]'::jsonb"))).toBe(true);
  });

  test("resumes a crash after staging without duplicating persisted membership", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const stagedIds = new Set<string>();
    const strobeRow = {
      ...strobe,
      first_at: strobe.firstAt,
      closes_at: strobe.closesAt,
      winner_event_location_ids: [],
      flow_snapshot: null,
    };
    const ds = {
      transaction: async <T>(body: (manager: { query: Query }) => Promise<T>) =>
        body({
          query: async (sql: string, params?: unknown[]) => {
            calls.push({ sql, params });
            if (sql.includes("INSERT INTO state_track_strobe") && sql.includes("ON CONFLICT")) {
              return [];
            }
            if (sql.includes("FROM state_track_strobe") && sql.includes("threat_profile")) {
              return [strobeRow];
            }
            if (sql.includes("INSERT INTO state_track_strobe_member")) {
              const eventLocationId = params?.[0] as string;
              if (stagedIds.has(eventLocationId)) return [];
              stagedIds.add(eventLocationId);
              return [{ event_location_id: eventLocationId }];
            }
            return [];
          },
        }),
    } as unknown as DataSource;
    const candidate = createCandidate("00000000-0000-0000-0000-000000000011");
    const config = trackingPipelineConfigSchema.parse({});

    // Первая попытка завершилась после commit staging и до materialize.
    await expect(stageTrackingCandidates(ds, [candidate], config)).resolves.toEqual([strobe.id]);
    // Новый worker видит persisted membership и не создаёт второй member.
    await expect(stageTrackingCandidates(ds, [candidate], config)).resolves.toEqual([]);

    expect(stagedIds).toEqual(new Set([candidate.eventLocationId]));
    expect(calls.filter(call => call.sql.includes("ON CONFLICT (event_location_id) DO NOTHING"))).toHaveLength(2);
  });
});

type Query = (sql: string, params?: unknown[]) => Promise<unknown>;

function createCandidate(eventLocationId: string): TrackingCandidate {
  return {
    affectsKinematics: true,
    eventCategory: null,
    eventLocationId,
    eventType: "warning",
    frontDistanceKm: 300,
    isFrontRegion: false,
    isInteriorRf: true,
    lat: 50,
    lon: 30,
    mode: "correct",
    nearestFrontLat: 49,
    nearestFrontLon: 30,
    occurredAt: strobe.firstAt,
    parsedEventId: eventLocationId,
    placeId: null,
    precision: "coords",
    sourceRefs: [{ eventLocationId, parsedEventId: eventLocationId }],
    threatProfile: "uav",
    trust: 1,
  };
}
