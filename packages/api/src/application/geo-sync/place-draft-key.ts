/**
 * ---
 * layer: application/geo-sync
 * domain: geo
 * purpose: Канонический ключ сопоставления place draft для sync и источников каталога.
 * ---
 */
import { resolvePlaceIdentityKey } from "@radar/shared";
import type { PlaceDraft } from "@radar/shared";

/** Преобразует draft в ключ, общий для plan diff и всех geo-провайдеров. */
export function placeDraftKey(row: PlaceDraft): string {
  return resolvePlaceIdentityKey({
    fiasId: row.fiasId,
    oktmo: row.oktmo,
    regionKey: row.regionCode,
    kind: row.kind,
    name: row.name,
  });
}
