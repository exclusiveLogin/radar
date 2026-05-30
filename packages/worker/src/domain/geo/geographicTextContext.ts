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
  const tokens = normalize(alias)
    .split(/\s+/)
    .map((token) => token.replace(/\./g, ""));
  return tokens.some((token) => SUBJECT_TYPE_TOKENS.has(token));
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

  return containsWholeToken(haystack, region.name) && isExplicitFederalSubjectAlias(region.name);
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
 * Отбрасывать ли привязку к субъекту: ложное срабатывание по прилагательному при якоре/явном другом субъекте.
 */
export function shouldSuppressFederalSubjectMatch(
  rawText: string,
  region: RegionCandidate,
  anchors: LocalityAnchor[],
): boolean {
  if (regionHasExplicitMentionInText(rawText, region)) {
    return false;
  }

  if (anchors.length > 0 && !regionMatchesLocalityAnchors(region.code, anchors)) {
    return true;
  }

  return false;
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

/** Блок lookup региона по первому слову для места без типа субъекта при якоре в тексте. */
export function isBlockedRegionCatalogLookup(
  placeName: string,
  catalogRegionName: string,
  catalogRegionCode: string,
  anchors: LocalityAnchor[],
): boolean {
  const placeWord = normalize(placeName).split(/\s+/)[0] ?? "";
  const catalogWord = normalize(catalogRegionName).split(/\s+/)[0] ?? "";
  if (!placeWord || !catalogWord) {
    return false;
  }

  if (placeWord.startsWith("приморско") && catalogWord === "приморский") {
    return true;
  }

  if (placeWord !== catalogWord) {
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

/** Запрос в DaData/Nominatim с привязкой к субъекту (омонимы «…ский район»). */
export function buildRegionScopedGeocodeQuery(
  placeName: string,
  regionName: string,
): string {
  const place = placeName.trim();
  const region = regionName.trim();
  if (!place || !region) {
    return place || region;
  }
  return `${place}, ${region}, Россия`;
}

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
export function resolveEnricherGeocode(
  rawText: string,
  catalogPlaces: GeocodeCatalogPlace[] | undefined,
  catalogRegions: RegionCandidate[] | undefined,
): EnricherGeocodeResolution {
  const places = catalogPlaces ?? [];
  const regions = catalogRegions ?? [];
  if (places.length === 0 || regions.length === 0) {
    return { query: rawText };
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
      query: buildRegionScopedGeocodeQuery(primaryPlace.name, parentRegion.name),
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
