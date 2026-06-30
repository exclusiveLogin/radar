/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking
 * purpose: Диспетчер алгоритма ассоциации (GNN default; PDAF/JPDAF — backlog).
 * ---
 */
import { resolveAssignments } from "./assignCandidates";
import type { ResolveOpts, AssignStats, AssignDecision } from "./assignCandidates";
import type { ProfileKinematics } from "./profileKinematics";
import type { TrackAttentionTarget } from "./attentionMatrix";
import type { TrackingCandidate } from "./types";

export type AssociationAlgorithm = "gnn" | "pdaf" | "jpdaf" | "greedy-flow" | "nextgen-gravity";

export type AssociationDispatchOpts = ResolveOpts & {
  associationAlgorithm?: AssociationAlgorithm;
};

/**
 * Разрешает assign по выбранному алгоритму.
 * PDAF/JPDAF пока делегируют в GNN (скаффолд админки).
 */
export function resolveAssignmentsForAlgorithm(
  candidates: TrackingCandidate[],
  tracks: TrackAttentionTarget[],
  kin: ProfileKinematics,
  opts: AssociationDispatchOpts,
): { decisions: AssignDecision[]; stats: AssignStats } {
  const algo = opts.associationAlgorithm ?? "gnn";
  switch (algo) {
    case "gnn":
      return resolveAssignments(candidates, tracks, kin, opts);
    case "pdaf":
    case "jpdaf":
      return resolveAssignments(candidates, tracks, kin, opts);
    default:
      return resolveAssignments(candidates, tracks, kin, opts);
  }
}
