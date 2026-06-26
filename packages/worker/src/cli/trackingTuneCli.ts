/**
 * Offline harness: pattern search tune на in-memory срезе кандидатов.
 * Usage: npx tsx packages/worker/src/cli/trackingTuneCli.ts [--limit 1000]
 */
import {
  PROFILE_KINEMATICS,
  stdbscanDedup,
  computeTrackingFitness,
  patternSearchStep,
  probeCenter,
  tuneCenterFromProfile,
  defaultTuneAxes,
  canEnterAttention,
  type TrackingCandidate,
  type ThreatProfile,
} from "@radar/shared";

/** In-memory симуляция assign — упрощённый прогон для fitness. */
function simulateTrackCount(candidates: TrackingCandidate[], profile: ThreatProfile): number {
  const kin = PROFILE_KINEMATICS[profile];
  const { deduplicated } = stdbscanDedup(
    candidates.filter(canEnterAttention),
    {
      epsilonSpatialM: kin.stdbscanEpsilonSpatialM,
      epsilonTemporalMs: kin.stdbscanEpsilonTemporalMs,
      minPts: kin.stdbscanMinPts,
    },
  );
  // proxy: число seed-eligible точек / 5 как грубая оценка track count
  return Math.max(1, Math.ceil(deduplicated.length / 5));
}

async function main(): Promise<void> {
  const limitArg = process.argv.find(a => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;
  const profile: ThreatProfile = "uav";
  const kin = PROFILE_KINEMATICS[profile];

  // Синтетический срез для offline harness (без БД)
  const candidates: TrackingCandidate[] = Array.from({ length: limit }, (_, i) => ({
    eventLocationId: `s-${i}`,
    parsedEventId: `pe-${i}`,
    occurredAt: new Date(Date.parse("2024-06-01T00:00:00Z") + i * 120_000),
    lat: 50 + (i % 20) * 0.01,
    lon: 36 + Math.floor(i / 20) * 0.02,
    placeId: null,
    precision: i % 3 === 0 ? "city" : "coords",
    trust: 0.8,
    eventType: i % 5 === 0 ? "danger" : "fixation",
    eventCategory: null,
    affectsKinematics: true,
    isFrontRegion: i % 7 === 0,
    isInteriorRf: false,
    threatProfile: profile,
    mode: "correct",
    sourceRefs: [],
  }));

  let state = {
    center: tuneCenterFromProfile(kin),
    stepFraction: 0.5,
    epoch: 0,
  };
  let bestFitness = -Infinity;
  let bestCenter = state.center;
  const grid: Array<Record<string, unknown>> = [];

  const maxEpochs = 6;
  while (state.epoch < maxEpochs) {
    let improved = false;
    for (const axis of defaultTuneAxes) {
      for (const dir of [-1, 1] as const) {
        const probe = probeCenter(state.center, axis, dir);
        const trackCount = simulateTrackCount(candidates, profile);
        const fitness = computeTrackingFitness({
          totalPoints: candidates.length,
          trackLengths: Array.from({ length: trackCount }, () => Math.ceil(candidates.length / trackCount)),
          meanAcceptDM: probe.chi2Threshold / 10,
          orphanCount: Math.floor(candidates.length * 0.1),
        });
        grid.push({ epoch: state.epoch, axis, dir, fitness: fitness.fitness, trackCount });
        if (fitness.fitness > bestFitness) {
          bestFitness = fitness.fitness;
          bestCenter = probe;
          state = { ...state, center: probe };
          improved = true;
        }
      }
    }
    state = patternSearchStep(state, improved);
  }

  console.log(JSON.stringify({ bestFitness, bestCenter, epochs: state.epoch, gridRows: grid.length }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
