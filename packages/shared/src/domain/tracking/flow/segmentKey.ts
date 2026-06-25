/**
 * ---
 * layer: shared
 * kind: domain
 * domain: tracking/flow
 * purpose: SSOT ключа P2P-сегмента для rollup (L2).
 *          Ключ — направленная пара (fromId, toId) с опциональным профилем угрозы.
 * ---
 */
import type { ThreatProfile } from "../types";

/** Ключ направленного сегмента — используется как key в Map для rollup. */
export type SegmentKeyStr = string;

/**
 * Строит строковый ключ сегмента для group-by.
 * Направленный: (A→B) ≠ (B→A).
 */
export function buildSegmentKey(
  fromId: string,
  toId: string,
  threatProfile?: ThreatProfile,
): SegmentKeyStr {
  return threatProfile
    ? `${fromId}|${toId}|${threatProfile}`
    : `${fromId}|${toId}`;
}
