import { regionStemKey } from "../region-canonicalization";

/**
 * Короткие подписи субъектов в FIAS xlsx (BorisGi/lenin) → канон regions.json.
 * Кемеровская область и большинство «область/край» сводятся через regionStemKey без записи.
 */
const FIAS_REGION_TO_CATALOG_LABEL: Record<string, string> = {
  "Кабардино-Балкария": "Кабардино-Балкарская",
  "Карачаево-Черкессия": "Карачаево-Черкесская",
  "Саха (Якутия)": "Саха /Якутия/",
  "Северная Осетия": "Северная Осетия - Алания",
  Удмуртия: "Удмуртская",
  "Ханты-Мансийский АО": "Ханты-Мансийский Автономный округ - Югра",
  Чечня: "Чеченская",
  Чувашия: "Чувашская Республика",
};

/** regionCode для PlaceDraft: стем канона regions.json. */
export function resolveFiasCatalogRegionCode(fiasRegionLabel: string): string {
  const trimmed = fiasRegionLabel.trim();
  const catalogLabel = FIAS_REGION_TO_CATALOG_LABEL[trimmed] ?? trimmed;
  return regionStemKey(catalogLabel);
}
