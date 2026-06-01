/** Порядок выборки raw по posted_at для claim/reparse/manual. */
export type RawMessagePostedAtOrder = "ASC" | "DESC";

/**
 * DESC (по умолчанию): сначала свежие сообщения — при бэкфилле реже перетирают актуальный статус.
 * RADAR_PHASE_CLAIM_ORDER=asc — прежнее поведение (с начала очереди).
 */
export function resolveRawMessagePostedAtOrder(): RawMessagePostedAtOrder {
  const raw = process.env.RADAR_PHASE_CLAIM_ORDER?.trim().toLowerCase();
  if (raw === "asc") return "ASC";
  return "DESC";
}
