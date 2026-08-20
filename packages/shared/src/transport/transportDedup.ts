/**
 * Idempotency port для RMQ consumer — L1 LRU + optional PG backend.
 */

/** true = первый раз (обработать), false = дубликат (skip). */
export interface ITransportDedup {
  tryClaim(eventId: string): Promise<boolean>;
}

const DEFAULT_LRU_SIZE = 10_000;

/** In-memory L1 — быстрый фильтр повторов в рамках процесса. */
export function createLruTransportDedup(maxSize = DEFAULT_LRU_SIZE): ITransportDedup {
  const seen = new Set<string>();
  return {
    async tryClaim(eventId: string): Promise<boolean> {
      if (seen.has(eventId)) return false;
      seen.add(eventId);
      if (seen.size > maxSize) seen.clear();
      return true;
    },
  };
}

/** L1 LRU + L2 (PG): оба должны пройти для claim. */
export function createCompositeTransportDedup(
  l1: ITransportDedup,
  l2?: ITransportDedup,
): ITransportDedup {
  if (!l2) return l1;
  return {
    async tryClaim(eventId: string): Promise<boolean> {
      const l1Ok = await l1.tryClaim(eventId);
      if (!l1Ok) return false;
      return l2.tryClaim(eventId);
    },
  };
}
