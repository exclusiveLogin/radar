/**
 * ---
 * layer: shared/ports
 * purpose: Persisted busy→stabilized claim для cascade-триггеров (cross-replica).
 * ---
 */

export type PipelineStabilityStatus = "busy" | "stabilized";

export interface IPipelineStabilityRepository {
  markBusy(scopeKey: string): Promise<void>;
  /**
   * Атомарный claim busy→stabilized.
   * @returns true только у победителя гонки.
   */
  tryClaimStabilized(scopeKey: string): Promise<boolean>;
}
