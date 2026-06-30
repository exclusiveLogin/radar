/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Phase B resolve — in-locus / soft / seed / intercept + consumed SSOT.
 * ---
 */
import { shouldTerminateOnAttach } from "./eventTypeCoefficients";
import {
  canSeedCandidate,
  DEFAULT_SEED_MAX_FRONT_DISTANCE_KM,
  DEFAULT_SEED_WEIGHTS,
  DEFAULT_SEED_MIN,
} from "./pointWeightModel";
import type { SeedWeights } from "./pointWeightModel";
import {
  buildAttentionMatrix,
  type AttentionMatrixRow,
  type TrackAttentionTarget,
} from "./attentionMatrix";
import type { AssociationAlgorithm } from "./associationDispatch";
import type { CorridorRollupIndex } from "./flow/corridorRollupIndex";
import type { MagnetCostWeights, MagnetismIndex } from "./applyMagnetWeights";
import { DEFAULT_FLOW_ALIGNMENT, type FlowAlignmentWeights } from "./flowAlignment";
import type { ProfileKinematics } from "./profileKinematics";
import type { TrackingCandidate } from "./types";

export const DEFAULT_TIE_EPSILON = 0.5;
/** Реэкспорт для внешних потребителей — SSOT в attentionMatrix.ts. */
export { DEFAULT_MAX_SOFT as DEFAULT_MAX_CONSECUTIVE_SOFT } from "./attentionMatrix";

export type AssignDecision =
  | { kind: "link"; candidate: TrackingCandidate; trackId: string; soft: boolean }
  | { kind: "seed"; candidate: TrackingCandidate }
  | { kind: "intercept"; candidate: TrackingCandidate; trackId: string }
  | { kind: "skip"; candidate: TrackingCandidate; reason: string };

export type AssignStats = {
  links: number;
  softLinks: number;
  seeds: number;
  intercepts: number;
  skips: number;
  attentionConflicts: number;
};

export type ResolveOpts = {
  consumed: Set<string>;
  seedMin?: number;
  seedMaxFrontDistanceKm?: number;
  seedWeights?: SeedWeights;
  flowWeights?: FlowAlignmentWeights;
  reuseAcrossTracks?: boolean;
  associationAlgorithm?: AssociationAlgorithm;
  corridorIndex?: CorridorRollupIndex;
  magnetismIndex?: MagnetismIndex;
  magnetCost?: MagnetCostWeights;
  tieEpsilon?: number;
  maxConsecutiveSoft?: number;
};

/**
 * Разрешает assign для одной строки матрицы (Phase B decision tree).
 * Возвращает массив решений (multi-link при reuseAcrossTracks).
 */
export function resolveRowAssignment(
  row: AttentionMatrixRow,
  _kin: ProfileKinematics,
  opts: ResolveOpts,
): AssignDecision[] {
  const { candidate } = row;
  const seedMin = opts.seedMin ?? DEFAULT_SEED_MIN;
  const seedMaxFrontKm = opts.seedMaxFrontDistanceKm ?? DEFAULT_SEED_MAX_FRONT_DISTANCE_KM;
  const seedWeights = opts.seedWeights ?? DEFAULT_SEED_WEIGHTS;
  const tieEpsilon = opts.tieEpsilon ?? DEFAULT_TIE_EPSILON;
  const reuse = opts.reuseAcrossTracks ?? false;

  if (shouldTerminateOnAttach(candidate.eventType)) {
    const winner = pickLinkWinner(row.links, tieEpsilon, candidate);
    if (winner) {
      return [{ kind: "intercept", candidate, trackId: winner.trackId }];
    }
    return [{ kind: "skip", candidate, reason: "intercept_no_track" }];
  }

  if (reuse) {
    const inLocusLinks = row.links.filter(l => l.inLocus);
    if (inLocusLinks.length > 0) {
      return inLocusLinks.map(l => ({
        kind: "link" as const,
        candidate,
        trackId: l.trackId,
        soft: false,
      }));
    }
  } else {
    const winner = pickLinkWinner(row.links, tieEpsilon, candidate);
    if (winner?.inLocus) {
      return [{ kind: "link", candidate, trackId: winner.trackId, soft: false }];
    }
    if (winner?.softEligible) {
      return [{ kind: "link", candidate, trackId: winner.trackId, soft: true }];
    }
  }

  if (canSeedCandidate(candidate, seedMin, seedMaxFrontKm, seedWeights)) {
    return [{ kind: "seed", candidate }];
  }

  const winner = pickLinkWinner(row.links, tieEpsilon, candidate);
  if (winner && !winner.inLocus) {
    return [{ kind: "skip", candidate, reason: "outside_locus_no_seed" }];
  }

  return [{ kind: "skip", candidate, reason: "no_match" }];
}

/** Выбирает winner по min linkCost (ρ') с tie-break. */
function pickLinkWinner(
  links: AttentionMatrixRow["links"],
  tieEpsilon: number,
  candidate: TrackingCandidate,
) {
  if (links.length === 0) return null;

  const sorted = [...links].sort((a, b) => a.linkCost - b.linkCost);
  const best = sorted[0]!;

  const tied = sorted.filter(l => l.linkCost - best.linkCost <= tieEpsilon);
  if (tied.length <= 1) return best;

  tied.sort((a, b) => {
    const csA = candidate.clusterSize ?? 1;
    const csB = candidate.clusterSize ?? 1;
    if (csB !== csA) return csB - csA;
    return a.rhoPrime - b.rhoPrime;
  });

  return tied[0] ?? best;
}

/**
 * Полный batch resolve — настоящий GNN (sort-then-greedy).
 *
 * Алгоритм:
 *  1. Строим полную attention-матрицу один раз для всех кандидатов.
 *  2. Intercept-фаза: кандидаты с shouldTerminateOnAttach обрабатываются
 *     до GNN — каждый берёт лучший трек по linkCost.
 *  3. GNN-фаза (reuse=false): все assignable-ссылки сортируются глобально по
 *     linkCost; greedy-assign с отслеживанием consumedCandidates + consumedTracks.
 *     Это устраняет "звёзды" — каждый трек получает не более одного кандидата.
 *  4. Multi-link-фаза (reuse=true): кандидат линкуется ко всем in-locus трекам.
 *  5. Seed/skip-фаза: неназначенные кандидаты проходят через canSeedCandidate.
 */
export function resolveAssignments(
  candidates: TrackingCandidate[],
  tracks: TrackAttentionTarget[],
  kin: ProfileKinematics,
  opts: ResolveOpts,
): { decisions: AssignDecision[]; stats: AssignStats } {
  const stats: AssignStats = {
    links: 0,
    softLinks: 0,
    seeds: 0,
    intercepts: 0,
    skips: 0,
    attentionConflicts: 0,
  };

  const decisions: AssignDecision[] = [];
  const consumed = opts.consumed;
  const reuse = opts.reuseAcrossTracks ?? false;
  const tieEpsilon = opts.tieEpsilon ?? DEFAULT_TIE_EPSILON;
  const seedMin = opts.seedMin ?? DEFAULT_SEED_MIN;
  const seedMaxFrontKm = opts.seedMaxFrontDistanceKm ?? DEFAULT_SEED_MAX_FRONT_DISTANCE_KM;
  const seedWeights = opts.seedWeights ?? DEFAULT_SEED_WEIGHTS;

  // Единственный вызов buildAttentionMatrix для всего батча
  const rows = buildAttentionMatrix(candidates, tracks, kin, {
    consumed,
    seedMin: opts.seedMin,
    seedWeights: opts.seedWeights,
    flowWeights: opts.flowWeights,
    corridorIndex: opts.corridorIndex,
    magnetismIndex: opts.magnetismIndex,
    magnetCost: opts.magnetCost,
    maxConsecutiveSoft: opts.maxConsecutiveSoft,
  });

  // Разделяем intercept-кандидатов и обычных GNN-кандидатов
  const interceptRows: AttentionMatrixRow[] = [];
  const gnnRows: AttentionMatrixRow[] = [];
  for (const row of rows) {
    if (shouldTerminateOnAttach(row.candidate.eventType)) {
      interceptRows.push(row);
    } else {
      gnnRows.push(row);
    }
  }

  // --- Фаза Intercept: лучший трек по linkCost, consumedTracks не блокируются ---
  for (const row of interceptRows) {
    const winner = pickLinkWinner(row.links, tieEpsilon, row.candidate);
    if (winner) {
      decisions.push({ kind: "intercept", candidate: row.candidate, trackId: winner.trackId });
      consumed.add(row.candidate.eventLocationId);
      stats.intercepts++;
    } else {
      decisions.push({ kind: "skip", candidate: row.candidate, reason: "intercept_no_track" });
      stats.skips++;
    }
  }

  if (!reuse) {
    // --- GNN sort-then-greedy: каждый кандидат → ≤1 трек, каждый трек → ≤1 кандидат ---
    const assignableLinks = gnnRows
      .flatMap(row =>
        row.links
          .filter(link => link.inLocus || link.softEligible)
          .map(link => ({ row, link })),
      )
      .sort((a, b) => a.link.linkCost - b.link.linkCost);

    // Отдельные наборы consumed для кандидатов и треков внутри батча
    const consumedCandidates = new Set<string>();
    const consumedTracks = new Set<string>();

    for (const { row, link } of assignableLinks) {
      const candidateId = row.candidate.eventLocationId;
      if (consumedCandidates.has(candidateId) || consumedTracks.has(link.trackId)) continue;

      const soft = !link.inLocus;
      decisions.push({ kind: "link", candidate: row.candidate, trackId: link.trackId, soft });
      consumedCandidates.add(candidateId);
      consumedTracks.add(link.trackId);
      consumed.add(candidateId);
      if (soft) stats.softLinks++;
      else stats.links++;
    }

    // Seed/skip для неназначенных GNN-кандидатов
    for (const row of gnnRows) {
      const candidateId = row.candidate.eventLocationId;
      if (consumedCandidates.has(candidateId)) continue;

      if (canSeedCandidate(row.candidate, seedMin, seedMaxFrontKm, seedWeights)) {
        decisions.push({ kind: "seed", candidate: row.candidate });
        consumed.add(candidateId);
        stats.seeds++;
      } else {
        const reason = row.links.length > 0 ? "outside_locus_no_seed" : "no_match";
        decisions.push({ kind: "skip", candidate: row.candidate, reason });
        stats.skips++;
      }
    }
  } else {
    // --- Multi-link (reuse=true): кандидат → все in-locus треки ---
    for (const row of gnnRows) {
      const inLocusLinks = row.links.filter(l => l.inLocus);

      if (inLocusLinks.length > 0) {
        for (const link of inLocusLinks) {
          decisions.push({ kind: "link", candidate: row.candidate, trackId: link.trackId, soft: false });
          stats.links++;
        }
        // Кандидат с несколькими in-locus треками — фиксируем конфликты внимания
        if (inLocusLinks.length > 1) stats.attentionConflicts += inLocusLinks.length - 1;
        // reuse: кандидат не добавляется в consumed — остаётся доступным для других батчей
        continue;
      }

      if (canSeedCandidate(row.candidate, seedMin, seedMaxFrontKm, seedWeights)) {
        decisions.push({ kind: "seed", candidate: row.candidate });
        consumed.add(row.candidate.eventLocationId);
        stats.seeds++;
      } else {
        const reason = row.links.length > 0 ? "outside_locus_no_seed" : "no_match";
        decisions.push({ kind: "skip", candidate: row.candidate, reason });
        stats.skips++;
      }
    }
  }

  return { decisions, stats };
}
