import type { RegionDraft } from "@radar/shared";
import { normalizeName } from "./geo-provider-utils";

/**
 * Канонизация регионов из нескольких гео-источников в один SSOT.
 *
 * Проблема: identity-источник (hflabs) даёт настоящий ISO/FIAS, а geojson-источники
 * несут только геометрию и «сырое» имя. Раньше geojson клали имя в поле `iso`, из-за
 * чего composite-дедуп не склеивал варианты («обл.»/«область») с каноном → фантом-регионы.
 *
 * Решение детерминированное, без LLM: группируем драфты по «стему» имени (имя без
 * типового токена), внутри группы берём identity-драфт с настоящим ISO как канон и
 * доливаем в него геометрию из geojson-драфтов. Группы без настоящего ISO отбрасываем
 * (логируются вызывающим), фантом не рождается.
 */

/** Типовые токены субъекта РФ — срезаются при вычислении стема. */
const REGION_TYPE_TOKENS = new Set<string>([
  "область",
  "обл",
  "край",
  "республика",
  "респ",
  "автономная",
  "автономный",
  "ао",
  "округ",
  "город",
  "г",
  "федерального",
  "значения",
]);

/** Настоящий ISO субъекта РФ: RU-XXX (латиница). */
const ISO_PATTERN = /^[A-Z]{2}-[A-Z0-9]+$/;

/**
 * Нерегулярные имена, не сводимые простым срезом типа к канону hflabs.
 * Ключ — стем варианта из geojson, значение — стем канона hflabs.
 * Это детерминированный SSOT исключений (заполняется по логам dropped).
 */
const MANUAL_REGION_STEM_REMAP: Record<string, string> = {
  // geojson «Кемеровская область» → канон hflabs «Кемеровская область - Кузбасс»
  кемеровская: "кемеровская кузбасс",
  // geojson «Чувашская Республика - Чувашия» → канон hflabs «Чувашская Республика»
  "чувашия чувашская": "чувашская",
};

/**
 * Канон-ключ субъекта: нормализованное имя без типовых токенов, токены
 * уникальны и отсортированы. Дедуп убирает скобочные дубли («Адыгея (Адыгея)»).
 * «Воронежская обл.» / «Воронежская область» / «Воронежская» → "воронежская".
 */
export function regionStemKey(name: string): string {
  const tokens = normalizeName(name)
    .split(" ")
    .filter((token) => token.length > 0 && !REGION_TYPE_TOKENS.has(token));
  const stem = [...new Set(tokens)].sort().join(" ");
  return MANUAL_REGION_STEM_REMAP[stem] ?? stem;
}

/** Драфт несёт настоящий ISO (identity-источник, например hflabs). */
function hasCanonicalIso(draft: RegionDraft): boolean {
  return Boolean(draft.iso && ISO_PATTERN.test(draft.iso));
}

/** Доливает геометрию/округ из geojson-драфтов в канон-identity без перезаписи. */
function mergeGroupIntoIdentity(
  identity: RegionDraft,
  group: RegionDraft[],
): RegionDraft {
  const merged: RegionDraft = { ...identity };
  for (const draft of group) {
    if (draft === identity) continue;
    merged.geometryArtifactKey ??= draft.geometryArtifactKey;
    merged.centroidLat ??= draft.centroidLat;
    merged.centroidLon ??= draft.centroidLon;
    merged.federalDistrict ??= draft.federalDistrict;
  }
  return merged;
}

export type RegionCanonicalizationResult = {
  regions: RegionDraft[];
  dropped: Array<{ name: string; stem: string }>;
};

/**
 * Сводит региональные драфты всех источников к одному канон-региону на субъект.
 * Канон — драфт с настоящим ISO; геометрия доливается из остальных членов группы.
 */
export function canonicalizeRegions(
  drafts: RegionDraft[],
): RegionCanonicalizationResult {
  const groups = new Map<string, RegionDraft[]>();
  for (const draft of drafts) {
    const key = regionStemKey(draft.name);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(draft);
    } else {
      groups.set(key, [draft]);
    }
  }

  const regions: RegionDraft[] = [];
  const dropped: RegionCanonicalizationResult["dropped"] = [];
  for (const [stem, group] of groups) {
    const identity = group.find(hasCanonicalIso);
    if (!identity) {
      dropped.push({ name: group[0].name, stem });
      continue;
    }
    regions.push(mergeGroupIntoIdentity(identity, group));
  }
  return { regions, dropped };
}
