/**
 * ---
 * layer: worker/application
 * domain: tracking
 * purpose: Детерминированный parity harness production-domain блоков.
 *          Это не PostgreSQL integration test: SQL checkpoint проверяется отдельно.
 * ---
 */
import { describe, expect, test } from "vitest";
import {
  H3VectorFlowMap,
  compareTrackingCandidates,
  createTrackingStrobeBounds,
  trackingPipelineConfigSchema,
  type TrackingCandidate,
} from "@radar/shared";
import type { DataSource } from "typeorm";
import { runTrackingResearchVariant } from "./research/trackingResearchHarness.js";
import { runIncrementalBatch } from "./trackingRebuildService.js";

const STROBE_WINDOW_MS = 20 * 60_000;
const FIXTURE_START = Date.UTC(2026, 6, 31, 10);
const BATCH_SIZES = [1, 10, 50, 500] as const;

type CanonicalStrobe = {
  closesAt: string;
  eventLocationIds: string[];
  firstAt: string;
  profile: string;
};

type ParityArtifact = {
  consumed: string[];
  flowSnapshot: ReturnType<H3VectorFlowMap["exportSnapshot"]>;
  nodes: string[];
  strobes: CanonicalStrobe[];
  tracks: ReturnType<typeof runTrackingResearchVariant>["tracks"];
  watermark: string | null;
  winners: string[];
};

/**
 * Один fixture проходит через разные SQL-page границы.
 * Материализация strobe всегда использует полный накопленный membership.
 */
async function drainByPageSize(batchSize: number): Promise<ParityArtifact> {
  const config = trackingPipelineConfigSchema.parse({
    // batchSize=1 — DoD граница page I/O, ниже допустимого persisted config.
    batchSize: 10,
    strobe: { maxWindowMs: STROBE_WINDOW_MS },
  });
  const candidates = createFixture();
  const strobes = collectStrobes(candidates, batchSize, config.strobe.maxWindowMs);
  const ds = createCheckpointDataSource();
  const flowField = new H3VectorFlowMap(config.nextgen?.h3Resolution ?? 8);
  const consumed = new Set<string>();
  const winners = new Set<string>();
  let watermark: string | null = null;

  for (const strobe of strobes) {
    const result = await runIncrementalBatch(ds, {
      candidates: strobe.candidates,
      candidateWindow: strobe.candidates,
      checkpoint: { runId: "00000000-0000-0000-0000-000000000100", totalCandidates: candidates.length },
      checkpointStrobeId: strobe.id,
      config,
      flowField,
      fullPendingIds: new Set(strobe.candidates.map(candidate => candidate.eventLocationId)),
      rebuildAt: new Date(FIXTURE_START + 2 * STROBE_WINDOW_MS),
      rebuildGen: "parity",
    });

    result.winnerEventLocationIds.forEach(id => winners.add(id));
    strobe.candidates.forEach(candidate => consumed.add(candidate.eventLocationId));
    watermark = result.watermark?.lastEventLocationId ?? watermark;
  }

  const research = runTrackingResearchVariant(candidates, config, "baseline");
  return {
    consumed: [...consumed].sort(),
    flowSnapshot: flowField.exportSnapshot(),
    nodes: Object.keys(research.membership).sort(),
    strobes: strobes.map(({ candidates: members }) => ({
      closesAt: createTrackingStrobeBounds(members[0]!.occurredAt, config.strobe).closesAt.toISOString(),
      eventLocationIds: members.map(candidate => candidate.eventLocationId),
      firstAt: members[0]!.occurredAt.toISOString(),
      profile: members[0]!.threatProfile,
    })),
    tracks: research.tracks,
    watermark,
    winners: [...winners].sort(),
  };
}

/**
 * Модель persisted membership: page size меняет лишь момент staging,
 * а не состав закрытого event-time strobe.
 */
function collectStrobes(
  candidates: TrackingCandidate[],
  batchSize: number,
  maxWindowMs: number,
): Array<{ id: string; candidates: TrackingCandidate[] }> {
  const byProfile = new Map<string, Array<{ id: string; candidates: TrackingCandidate[] }>>();

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    for (const candidate of candidates.slice(offset, offset + batchSize)) {
      const profileStrobes = byProfile.get(candidate.threatProfile) ?? [];
      const current = profileStrobes.at(-1);
      const bounds = current && createTrackingStrobeBounds(
        current.candidates[0]!.occurredAt,
        { maxWindowMs },
      );
      const strobe = bounds && candidate.occurredAt <= bounds.closesAt
        ? current
        : { id: `strobe-${candidate.threatProfile}-${profileStrobes.length}`, candidates: [] };

      if (!current || strobe !== current) profileStrobes.push(strobe);
      strobe.candidates.push(candidate);
      byProfile.set(candidate.threatProfile, profileStrobes);
    }
  }

  return [...byProfile.values()]
    .flat()
    .sort((left, right) => compareTrackingCandidates(left.candidates[0]!, right.candidates[0]!));
}

/**
 * Контрактный DataSource возвращает только результаты read-портов, нужные domain batch.
 * Записи намеренно не эмулируют PostgreSQL: цель — проверить детерминизм алгоритма.
 */
function createCheckpointDataSource(): DataSource {
  const query = async (sql: string): Promise<unknown> => {
    if (sql.includes("FROM mat_track")) return [];
    if (sql.includes("SELECT enabled FROM state_track_pipeline")) return [{ enabled: true }];
    return [];
  };

  return {
    query,
    transaction: async <T>(body: (manager: { query: typeof query }) => Promise<T>) => body({ query }),
  } as unknown as DataSource;
}

function createFixture(): TrackingCandidate[] {
  return [
    fixtureCandidate("00000000-0000-0000-0000-000000000001", 0, 30),
    fixtureCandidate("00000000-0000-0000-0000-000000000002", 2, 30.01),
    fixtureCandidate("00000000-0000-0000-0000-000000000003", 4, 30.02),
    fixtureCandidate("00000000-0000-0000-0000-000000000004", 25, 30.03),
    fixtureCandidate("00000000-0000-0000-0000-000000000005", 27, 30.04),
    fixtureCandidate("00000000-0000-0000-0000-000000000006", 29, 30.05),
  ];
}

function fixtureCandidate(
  eventLocationId: string,
  offsetMinutes: number,
  lon: number,
): TrackingCandidate {
  return {
    affectsKinematics: true,
    eventCategory: null,
    eventLocationId,
    eventType: "warning",
    frontDistanceKm: lon * 10,
    isFrontRegion: false,
    isInteriorRf: true,
    lat: 50,
    lon,
    mode: "correct",
    nearestFrontLat: 49,
    nearestFrontLon: 30,
    occurredAt: new Date(FIXTURE_START + offsetMinutes * 60_000),
    parsedEventId: eventLocationId,
    placeId: null,
    precision: "coords",
    sourceRefs: [{ eventLocationId, parsedEventId: eventLocationId }],
    threatProfile: "uav",
    trust: 1,
  };
}

describe("tracking strobe parity harness", () => {
  test.each(BATCH_SIZES)(
    "preserves canonical strobes, winners, tracks, nodes, consumed, watermark and FlowMap for batchSize=%i",
    async (batchSize) => {
      const baseline = await drainByPageSize(BATCH_SIZES[0]);

      await expect(drainByPageSize(batchSize)).resolves.toEqual(baseline);
    },
  );
});
