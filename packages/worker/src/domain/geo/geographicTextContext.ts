import { stripChannelPlaceSuffix } from "../parsing/channelCityListPromo.js";
import {
  buildCatalogPlaceGeocodeQuery,
  buildRegionScopedGeocodeQuery,
  isFederalSubjectLabel,
} from "@radar/shared";

/**
 * Контекстная геопривязка по тексту сообщения.
 *
 * Принципы:
 * 1. Субъект РФ — только при явном упоминании (тип «край/обл/…» или полное имя), не по одному прилагательному.
 * 2. Если в тексте есть якорь (известный город из справочника) — регион места берётся от якоря,
 *    а не от совпавшего прилагательного в перечислении «район, город».
 * 3. Если в тексте несколько явных субъектов — короткие неявные совпадения отбрасываются.
 */

export type LocalityAnchor = {
  name: string;
  regionCode: string;
  kind: "city" | "locality" | "settlement";
};

export type RegionCandidate = {
  code: string;
  name: string;
  fiasId?: string;
  aliases?: string[];
};

/** Типы субъекта РФ для сопоставления короткого DB-name с полной формой в тексте. */
const SUBJECT_TYPE_TOKENS = new Set([
  "область",
  "обл",
  "край",
  "республика",
  "респ",
  "ао",
  "округ",
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Текст с границами токенов (пунктуация → пробел). */
export function toTokenHaystack(rawText: string): string {
  const punctStripped = normalize(rawText)
    .replace(/[,;:.!?()[\]{}«»""''–—−]/g, " ")
    .replace(/\s+/g, " ");
  return ` ${punctStripped} `;
}

/** Токен целиком в haystack (не префикс другого слова). */
export function containsWholeToken(haystack: string, token: string): boolean {
  const normalized = normalize(token);
  if (!normalized) {
    return false;
  }
  return haystack.includes(` ${normalized} `);
}

/** Нормализует код региона для сравнения (ISO / kladr / короткий). */
export function normalizeRegionLookupCode(code: string): string {
  return code.trim().toLowerCase().replace(/^ru-/, "");
}

export function regionCodesEquivalent(a: string, b: string): boolean {
  return normalizeRegionLookupCode(a) === normalizeRegionLookupCode(b);
}

/** Явное упоминание субъекта РФ: в алиасе есть тип или полное каноническое имя. */
export function isExplicitFederalSubjectAlias(alias: string): boolean {
  return isFederalSubjectLabel(alias);
}

/** Стебель названия субъекта без хвостового типа («… Респ» → «карачаево-черкесская»). */
function subjectStemFromCatalogName(name: string): string {
  return normalize(name)
    .replace(/\s+(республика|респ|область|обл|край|ао|округ)$/g, "")
    .trim();
}

/** Есть ли в тексте явная отсылка к этому субъекту (не только стем прилагательного). */
export function regionHasExplicitMentionInText(
  rawText: string,
  region: RegionCandidate,
): boolean {
  const haystack = toTokenHaystack(rawText);
  const canonical = normalize(region.name);

  for (const alias of region.aliases ?? []) {
    if (!alias || !containsWholeToken(haystack, alias)) {
      continue;
    }
    if (isExplicitFederalSubjectAlias(alias)) {
      return true;
    }
    if (normalize(alias) === canonical) {
      return true;
    }
  }

  if (containsWholeToken(haystack, region.name) && isExplicitFederalSubjectAlias(region.name)) {
    return true;
  }

  // DB: «Кабардино-Балкарская Респ», текст: «… Республика» — явный субъект
  const stem = subjectStemFromCatalogName(region.name);
  if (stem) {
    for (const typeToken of SUBJECT_TYPE_TOKENS) {
      if (containsWholeToken(haystack, `${stem} ${typeToken}`)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Якорные города/посёлки из справочника, реально присутствующие в тексте (целиком, не по части слова).
 * Сортировка: по позиции в тексте (раньше — выше).
 */
export function findLocalityAnchorsInText(
  rawText: string,
  catalog: LocalityAnchor[],
): LocalityAnchor[] {
  const haystack = toTokenHaystack(rawText);
  const found: Array<LocalityAnchor & { index: number }> = [];

  for (const anchor of catalog) {
    const names = [anchor.name];
    for (const name of names) {
      const token = normalize(name);
      const index = haystack.indexOf(` ${token} `);
      if (index >= 0) {
        found.push({ ...anchor, index });
        break;
      }
    }
  }

  return found
    .sort((a, b) => a.index - b.index)
    .map(({ index: _index, ...anchor }) => anchor);
}

/** Регион субъекта согласован с якорными городами в том же сообщении. */
export function regionMatchesLocalityAnchors(
  regionCode: string,
  anchors: LocalityAnchor[],
): boolean {
  if (anchors.length === 0) {
    return true;
  }
  const anchorRegions = new Set(
    anchors.map((anchor) => normalizeRegionLookupCode(anchor.regionCode)),
  );
  return anchorRegions.has(normalizeRegionLookupCode(regionCode));
}

/**
 * Отбрасывать ли привязку к субъекту: ложное срабатывание по прилагательному
 * без явного типа («край»/«обл»/…) и без подтверждающего locality-якоря.
 *
 * Принцип: субъект распознаётся только если в тексте есть
 * (а) явное упоминание с типом («Приморский край», «Краснодарская область») ИЛИ
 * (б) locality-якорь из того же субъекта.
 * Одиночный прилагательный («Приморский» без «край») — не достаточно.
 */
export function shouldSuppressFederalSubjectMatch(
  rawText: string,
  region: RegionCandidate,
  anchors: LocalityAnchor[],
): boolean {
  // Явное упоминание типа → не подавляем
  if (regionHasExplicitMentionInText(rawText, region)) {
    return false;
  }

  // Неявный alias: подтверждение требуется от locality-якоря того же субъекта.
  // Нет якоря совсем → подавляем (одно прилагательное не достаточно).
  if (anchors.length === 0) {
    return true;
  }

  return !regionMatchesLocalityAnchors(region.code, anchors);
}

/** Предпочтительный regionCode: единый регион всех якорей в тексте. */
export function inferPreferredRegionFromAnchors(
  anchors: LocalityAnchor[],
): string | null {
  if (anchors.length === 0) {
    return null;
  }
  const codes = [...new Set(anchors.map((anchor) => anchor.regionCode))];
  return codes.length === 1 ? (codes[0] ?? null) : (anchors[0]?.regionCode ?? null);
}

export function inferPreferredRegionCode(
  rawText: string,
  anchors: LocalityAnchor[],
): string | null {
  return inferPreferredRegionFromAnchors(anchors);
}

/**
 * Фильтр списка субъектов РФ с учётом якорей и явных упоминаний.
 */
export function filterRegionsByTextContext(
  regions: RegionCandidate[],
  rawText: string,
  anchors: LocalityAnchor[],
): RegionCandidate[] {
  let filtered = regions.filter(
    (region) => !shouldSuppressFederalSubjectMatch(rawText, region, anchors),
  );

  const hasExplicitSubject = filtered.some((region) =>
    regionHasExplicitMentionInText(rawText, region),
  );
  if (hasExplicitSubject) {
    filtered = filtered.filter(
      (region) =>
        regionHasExplicitMentionInText(rawText, region) ||
        (anchors.length > 0 &&
          regionMatchesLocalityAnchors(region.code, anchors)),
    );
  }

  const preferred = inferPreferredRegionFromAnchors(anchors);
  if (!preferred) {
    return filtered;
  }

  const hasPreferred = filtered.some((region) =>
    regionCodesEquivalent(region.code, preferred),
  );
  if (hasPreferred) {
    return filtered;
  }

  const anchor = anchors.find((item) => item.regionCode === preferred);
  return [
    {
      code: preferred,
      name: anchor?.name ? `${anchor.name} (регион якоря)` : preferred,
    },
    ...filtered,
  ];
}

export function shouldDropRegionAssignment(
  rawText: string,
  regionCode: string,
  region: RegionCandidate,
  anchors: LocalityAnchor[],
): boolean {
  return shouldSuppressFederalSubjectMatch(rawText, region, anchors);
}

/** Стебель прилагательного субъекта РФ: «приморский» → «примор», «новгородская» → «новгород». */
const SUBJECT_ADJECTIVE_STEM =
  /^(?<stem>.{4,})(?<suffix>ский|ская|ское|ской|ские)$/u;

function extractSubjectAdjectiveStem(word: string): string | null {
  const match = normalize(word).match(SUBJECT_ADJECTIVE_STEM);
  return match?.groups?.stem ?? null;
}

/**
 * Составной топоним с тем же корнем, что и прилагательное субъекта, но другой формой
 * («Приморско-Ахтарский» ≠ «Приморский край») — не матчить субъект по префиксу.
 */
export function isCompoundToponymClashingWithSubjectAdjective(
  placeName: string,
  catalogRegionName: string,
): boolean {
  if (isExplicitFederalSubjectAlias(placeName)) {
    return false;
  }

  const placeWord = normalize(placeName).split(/\s+/)[0] ?? "";
  const catalogWord = normalize(catalogRegionName).split(/\s+/)[0] ?? "";
  if (!placeWord || !catalogWord || placeWord === catalogWord) {
    return false;
  }

  const subjectStem = extractSubjectAdjectiveStem(catalogWord);
  if (!subjectStem) {
    return false;
  }

  const placeRoot = (placeWord.split("-")[0] ?? placeWord).trim();
  if (!placeRoot.startsWith(subjectStem) || placeRoot.length <= subjectStem.length) {
    return false;
  }

  return !catalogWord.startsWith(placeRoot);
}

/**
 * Блок lookup региона по первому слову: омонимия прилагательного субъекта vs микрорайон/район
 * при несовпадении якорей в тексте.
 */
export function isBlockedRegionCatalogLookup(
  placeName: string,
  catalogRegionName: string,
  catalogRegionCode: string,
  anchors: LocalityAnchor[],
): boolean {
  if (isCompoundToponymClashingWithSubjectAdjective(placeName, catalogRegionName)) {
    return true;
  }

  const placeWord = normalize(placeName).split(/\s+/)[0] ?? "";
  const catalogWord = normalize(catalogRegionName).split(/\s+/)[0] ?? "";
  if (!placeWord || !catalogWord || placeWord !== catalogWord) {
    return false;
  }

  if (isExplicitFederalSubjectAlias(placeName)) {
    return false;
  }

  if (anchors.length === 0) {
    return false;
  }

  return !regionMatchesLocalityAnchors(catalogRegionCode, anchors);
}

type GeocodeCatalogPlace = {
  name: string;
  kind: string;
};

export { buildRegionScopedGeocodeQuery };

/** Результат подготовки запроса к DaData/Nominatim. */
export type EnricherGeocodeResolution = {
  query: string;
  /** Имя места из catalog для merge с координатами enricher. */
  bindPlaceName?: string;
};

/**
 * Строит запрос для enricher: при районе/месте + субъекте в тексте — «место, регион, Россия»,
 * иначе полный rawText.
 */
/** Укороченный запрос для DaData, если catalog не нашёл НП (первая строка без «опасность/ракет…»). */
export function buildFallbackGeocodeQuery(rawText: string): string {
  const line = rawText.split(/\n/)[0]?.trim() ?? rawText.trim();
  const trimmed = line
    .split(/\s+(?:опасност|тревог|ракет|бпла|удар|сбит)/i)[0]
    ?.trim();
  return (trimmed || line).slice(0, 200);
}

export function resolveEnricherGeocode(
  rawText: string,
  catalogPlaces: GeocodeCatalogPlace[] | undefined,
  catalogRegions: RegionCandidate[] | undefined,
): EnricherGeocodeResolution {
  const places = catalogPlaces ?? [];
  const regions = catalogRegions ?? [];
  if (places.length === 0 || regions.length === 0) {
    return { query: buildFallbackGeocodeQuery(rawText) };
  }

  const primaryPlace =
    places.find((place) => place.kind === "district")
    ?? places.find((place) => place.kind === "city" || place.kind === "locality")
    ?? places[0];
  if (!primaryPlace) {
    return { query: rawText };
  }

  const explicitRegion = regions.find((region) =>
    regionHasExplicitMentionInText(rawText, region),
  );
  const parentRegion = explicitRegion ?? regions[0];
  if (!parentRegion) {
    return { query: rawText };
  }

  if (primaryPlace.kind === "district" || explicitRegion) {
    return {
      query: buildCatalogPlaceGeocodeQuery({
        placeName: primaryPlace.name,
        region: { name: parentRegion.name },
      }),
      bindPlaceName: primaryPlace.name,
    };
  }

  return { query: rawText };
}

/** @deprecated используй resolveEnricherGeocode */
export function resolveEnricherGeocodeQuery(
  rawText: string,
  catalogPlaces: GeocodeCatalogPlace[] | undefined,
  catalogRegions: RegionCandidate[] | undefined,
): string {
  return resolveEnricherGeocode(rawText, catalogPlaces, catalogRegions).query;
}

/** Регион НП из справочника places.json (точное имя / алиас после нормализации). */
export function lookupLocalityRegionForPlace(
  placeName: string,
  catalog: LocalityAnchor[],
): string | null {
  const target = normalize(stripChannelPlaceSuffix(placeName));
  if (!target) {
    return null;
  }

  for (const anchor of catalog) {
    if (normalize(anchor.name) === target) {
      return anchor.regionCode;
    }
  }

  return null;
}

/** Якорь в тексте, соответствующий имени места (не «первый якорь сообщения»). */
export function findAnchorForPlaceInText(
  placeName: string,
  rawText: string,
  anchorsInText: LocalityAnchor[],
): LocalityAnchor | null {
  const target = normalize(stripChannelPlaceSuffix(placeName));
  if (!target) {
    return null;
  }

  const haystack = toTokenHaystack(rawText);
  for (const anchor of anchorsInText) {
    if (normalize(anchor.name) !== target) {
      continue;
    }
    if (containsWholeToken(haystack, anchor.name)) {
      return anchor;
    }
  }

  return null;
}

/**
 * regionCode для place: справочник → якорь этой фразы → явный субъект.
 * Не подставляет «первый регион сообщения» при нескольких НП/якорях.
 */
export function resolvePlaceRegionCodeInContext(options: {
  placeName: string;
  placeRegionCode?: string;
  rawText: string;
  anchorsInText: LocalityAnchor[];
  localityCatalog: LocalityAnchor[];
  regionsCollected: RegionCandidate[];
  multiPlaceContext: boolean;
}): string | null {
  const fromCatalog = lookupLocalityRegionForPlace(
    options.placeName,
    options.localityCatalog,
  );
  if (fromCatalog) {
    return fromCatalog;
  }

  const textAnchor = findAnchorForPlaceInText(
    options.placeName,
    options.rawText,
    options.anchorsInText,
  );
  if (textAnchor) {
    return textAnchor.regionCode;
  }

  const { placeRegionCode } = options;
  if (placeRegionCode) {
    const matched = options.regionsCollected.find((item) =>
      regionCodesEquivalent(item.code, placeRegionCode),
    );
    if (matched) {
      if (
        shouldSuppressFederalSubjectMatch(
          options.rawText,
          matched,
          options.anchorsInText,
        )
      ) {
        return null;
      }
      return placeRegionCode;
    }
    // Код из finalizer/enricher: suppress относится к выводу по прилагательному, не к pipeline binding
    return placeRegionCode;
  }

  if (options.multiPlaceContext) {
    return null;
  }

  const singleAnchor = inferPreferredRegionFromAnchors(options.anchorsInText);
  if (singleAnchor) {
    return singleAnchor;
  }

  const explicitRegion = options.regionsCollected.find((region) =>
    regionHasExplicitMentionInText(options.rawText, region),
  );
  return explicitRegion?.code ?? null;
}
