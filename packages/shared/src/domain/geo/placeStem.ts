/**
 * Нормализует название места в стем для быстрого матча без alias-роста.
 *
 * Перед stem всегда normalizePlaceMatchLabel (ГО, городской округ и т.п.).
 *
 * SSOT: единственная функция нормализации для матча — не дублировать логику.
 */

import {
  collectPlaceMatchStems,
  normalizePlaceMatchLabel,
  placeStemCore,
} from "./placeMatchLabel";

export { collectPlaceMatchStems, normalizePlaceMatchLabel, placeStemCore };

/** Основная точка входа: label → stem с учётом муниципальных приписок. */
export function placeStem(name: string): string {
  return placeStemCore(normalizePlaceMatchLabel(name));
}
