/**
 * ---
 * layer: worker/application
 * domain: tracking/research
 * purpose: Read-only сборка исследовательских вариантов из production domain-блоков.
 *          Не пишет в L1 tracking tables и не меняет runtime pipeline.
 * ---
 */
import { createHash } from "node:crypto";
import {
  canEnterAttention,
  H3VectorFlowMap,
  NextGenStep1,
  NextGenStep2,
  NextGenStep3,
  registerNodeMasses,
  registerSegmentFlows,
  resolveNextGenFlowWeights,
  resolveNextGenRflPenaltyThreshold,
  resolveNextGenTurnPenalty,
  resolveProfileKinematics,
  resolveTrackingPipelineConfig,
  type NextGenAcceptedLink,
  type ThreatProfile,
  type TrackingCandidate,
  type TrackingPipelineConfig,
} from "@radar/shared";
import {
  computeTrackingResearchQuality,
  type TrackingResearchQuality,
} from "./trackingResearchQuality.js";

/** Preset наполнения H3-поля (исторические A/B-варианты). */
export type TrackingResearchFieldMode =
  | "baseline"
  | "no-field-direction"
  | "empty-environment";

/**
 * Спека прогона: id для артефактов + опциональный patch конфига + режим поля.
 * Строковые aliases (`baseline` и т.п.) остаются совместимы с CLI/тестами.
 */
export type TrackingResearchSpec =
  | TrackingResearchFieldMode
  | {
      id: string;
      fieldMode?: TrackingResearchFieldMode;
      configPatch?: Record<string, unknown>;
    };

export type TrackingResearchVariant = string;

type ResearchLink = {
  trackKey: string;
  fromEventLocationId: string;
  toEventLocationId: string;
  occurredAt: string;
  gapMs: number;
  distanceM: number;
  velocityMs: number;
  frontDeltaKm: number | null;
  alignment: number | null;
  cost: number;
  acceptedAtJoin: true;
};

type ResearchTrack = {
  trackKey: string;
  threatProfile: ThreatProfile;
  status: string;
  firstAt: string;
  lastAt: string;
  eventLocationIds: string[];
};

export type TrackingResearchArtifact = {
  variant: TrackingResearchVariant;
  tracks: ResearchTrack[];
  links: ResearchLink[];
  membership: Record<string, string>;
  stats: {
    inputCandidates: number;
    candidatesWithFrontDistance: number;
    assignedCandidates: number;
    tracks: number;
    reverseLinks: number;
    linksWithFrontDistance: number;
    step3Rejects: Record<string, number>;
    field: ReturnType<H3VectorFlowMap["exportSnapshot"]>;
  };
  quality: TrackingResearchQuality;
  preservation: {
    missingEventLocationIds: string[];
    duplicatedEventLocationIds: string[];
  };
};

const REVERSE_FRONT_DELTA_KM = -5;

const FIELD_PRESETS: readonly TrackingResearchFieldMode[] = [
  "baseline",
  "no-field-direction",
  "empty-environment",
];

/** Нормализует строковый alias или объектную спеку к единому виду. */
export function resolveTrackingResearchSpec(spec: TrackingResearchSpec): {
  id: string;
  fieldMode: TrackingResearchFieldMode;
  configPatch: Record<string, unknown>;
} {
  if (typeof spec === "string") {
    return { id: spec, fieldMode: spec, configPatch: {} };
  }
  return {
    id: spec.id,
    fieldMode: spec.fieldMode ?? "baseline",
    configPatch: spec.configPatch ?? {},
  };
}

/** Baseline H3 A/B + произвольные patch-варианты из CLI. */
export function defaultTrackingResearchSpecs(): TrackingResearchSpec[] {
  return [...FIELD_PRESETS];
}

/**
 * Собирает один вариант из тех же Step1/2/3, что использует production pipeline.
 * Различается наполненность in-memory H3 map и/или patch конфига.
 */
export function runTrackingResearchVariant(
  candidates: TrackingCandidate[],
  config: TrackingPipelineConfig,
  variant: TrackingResearchSpec,
): TrackingResearchArtifact {
  const resolved = resolveTrackingResearchSpec(variant);
  const effectiveConfig = resolveTrackingPipelineConfig(config, resolved.configPatch);
  const flowMap = new H3VectorFlowMap(effectiveConfig.nextgen?.h3Resolution ?? 8);
  const byProfile = groupByProfile(candidates.filter(canEnterAttention));
  const tracks: ResearchTrack[] = [];
  const links: ResearchLink[] = [];
  const membership: Record<string, string> = {};
  const assignedEventLocationIds: string[] = [];
  const step3Rejects: Record<string, number> = {};
  const candidatesById = new Map(
    candidates.map(candidate => [candidate.eventLocationId, candidate]),
  );

  for (const profile of Object.keys(byProfile) as ThreatProfile[]) {
    const profileResult = runProfile(
      byProfile[profile]!,
      profile,
      effectiveConfig,
      flowMap,
      resolved.fieldMode,
    );

    Object.assign(step3Rejects, prefixRejectStats(profile, profileResult.step3));
    const trackKeys = new Map<string, string>();

    for (const track of profileResult.tracks) {
      const eventLocationIds = track.nodes
        ?.map(node => node.sourceRefs[0]?.eventLocationId)
        .filter((id): id is string => Boolean(id)) ?? [];
      const trackKey = stableTrackKey(profile, eventLocationIds);
      trackKeys.set(track.id, trackKey);

      tracks.push({
        trackKey,
        threatProfile: profile,
        status: track.status,
        firstAt: track.firstAt.toISOString(),
        lastAt: track.lastAt.toISOString(),
        eventLocationIds,
      });
      for (const eventLocationId of eventLocationIds) {
        membership[eventLocationId] = trackKey;
        assignedEventLocationIds.push(eventLocationId);
      }
    }
    links.push(...profileResult.acceptedLinks.flatMap(link => {
      const trackKey = trackKeys.get(link.trackId);
      return trackKey
        ? [materializeAcceptedLink(trackKey, link, candidatesById)]
        : [];
    }));
  }

  const inputIds = new Set(candidates.map(candidate => candidate.eventLocationId));
  const membershipCounts = new Map<string, number>();
  for (const eventLocationId of assignedEventLocationIds) {
    membershipCounts.set(eventLocationId, (membershipCounts.get(eventLocationId) ?? 0) + 1);
  }

  const missingEventLocationIds = [...inputIds].filter(id => !membershipCounts.has(id));
  const duplicatedEventLocationIds = [...membershipCounts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const linksWithFrontDistance = links.filter(link => link.frontDeltaKm !== null);
  const artifactBase = {
    variant: resolved.id,
    tracks,
    links,
    membership,
    stats: {
      inputCandidates: candidates.length,
      candidatesWithFrontDistance: candidates.filter(
        candidate => candidate.frontDistanceKm !== null,
      ).length,
      assignedCandidates: membershipCounts.size,
      tracks: tracks.length,
      reverseLinks: linksWithFrontDistance.filter(
        link => link.frontDeltaKm! < REVERSE_FRONT_DELTA_KM,
      ).length,
      linksWithFrontDistance: linksWithFrontDistance.length,
      step3Rejects,
      field: flowMap.exportSnapshot(),
    },
    preservation: { missingEventLocationIds, duplicatedEventLocationIds },
  };

  return {
    ...artifactBase,
    quality: computeTrackingResearchQuality(artifactBase, candidates, effectiveConfig),
  };
}

function runProfile(
  candidates: TrackingCandidate[],
  profile: ThreatProfile,
  config: TrackingPipelineConfig,
  flowMap: H3VectorFlowMap,
  fieldMode: TrackingResearchFieldMode,
) {
  const kin = resolveProfileKinematics(profile, config.profiles);
  const nodes = NextGenStep1.execute(candidates, {
    epsilonSpatialM: kin.stdbscanEpsilonSpatialM,
    epsilonTemporalMs: kin.stdbscanEpsilonTemporalMs,
    minPts: kin.stdbscanMinPts,
  });

  if (fieldMode !== "empty-environment") registerNodeMasses(flowMap, nodes);

  const flowWeights = resolveNextGenFlowWeights(config);
  const step2 = NextGenStep2.execute(
    nodes,
    kin,
    flowMap,
    flowWeights,
    resolveNextGenRflPenaltyThreshold(config),
  );
  if (fieldMode === "baseline") registerSegmentFlows(flowMap, step2.segments);

  const step3 = NextGenStep3.assemble(
    nodes,
    kin,
    flowMap,
    flowWeights,
    resolveNextGenTurnPenalty(config),
    profile,
    config.nextgen?.minBackboneNodes ?? 3,
  );
  return {
    nodes,
    step3: step3.stats,
    tracks: step3.tracks,
    acceptedLinks: step3.acceptedLinks,
  };
}

function materializeAcceptedLink(
  trackKey: string,
  link: NextGenAcceptedLink,
  candidatesById: Map<string, TrackingCandidate>,
): ResearchLink {
  const previous = candidatesById.get(link.fromEventLocationId);
  const current = candidatesById.get(link.toEventLocationId);
  return {
    trackKey,
    fromEventLocationId: link.fromEventLocationId,
    toEventLocationId: link.toEventLocationId,
    occurredAt: link.occurredAt.toISOString(),
    gapMs: link.gapMs,
    distanceM: link.distanceM,
    velocityMs: link.velocityMs,
    frontDeltaKm:
      current?.frontDistanceKm == null || previous?.frontDistanceKm == null
        ? null
        : current.frontDistanceKm - previous.frontDistanceKm,
    alignment: link.alignment,
    cost: link.cost,
    acceptedAtJoin: true,
  };
}

function groupByProfile(
  candidates: TrackingCandidate[],
): Record<ThreatProfile, TrackingCandidate[]> {
  return candidates.reduce(
    (groups, candidate) => {
      (groups[candidate.threatProfile] ??= []).push(candidate);
      return groups;
    },
    {} as Record<ThreatProfile, TrackingCandidate[]>,
  );
}

function stableTrackKey(
  profile: ThreatProfile,
  eventLocationIds: string[],
): string {
  const digest = createHash("sha256")
    .update(`${profile}:${eventLocationIds.join(",")}`)
    .digest("hex")
    .slice(0, 16);
  return `${profile}-${digest}`;
}

function prefixRejectStats(
  profile: ThreatProfile,
  stats: {
    rejectGap: number;
    rejectDistance: number;
    rejectVelocity: number;
    rejectCounterFlow: number;
    rejectTurn: number;
    rejectKalmanInnovation: number;
  },
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(stats).map(([reason, count]) => [`${profile}.${reason}`, count]),
  );
}
