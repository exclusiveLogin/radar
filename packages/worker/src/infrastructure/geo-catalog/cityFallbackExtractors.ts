type CityPatternExtractor = {
  id: string;
  extract(rawText: string): string[];
};

const CITY_TOKEN_PATTERN = /[А-ЯЁ][а-яё-]{2,}/u;
const NOISE_LINE_PATTERN =
  /(область|край|республика|ао|район|бпла|пво|опасност|внимани|фиксац|отбой|ограничения|ивп|работа|сбит|угроза|меры|подписаться|обход|радар|@)/iu;

function normalizeCandidate(value: string): string {
  return value.replace(/[.?!;:]/g, "").trim();
}

function isCityCandidate(value: string): boolean {
  return CITY_TOKEN_PATTERN.test(value);
}

function shouldSkipLine(value: string): boolean {
  return NOISE_LINE_PATTERN.test(value);
}

const airportExtractor: CityPatternExtractor = {
  id: "airport",
  extract(rawText: string): string[] {
    const result: string[] = [];
    const matches = rawText.matchAll(/аэропорт\s+([А-ЯЁ][а-яё-]{2,})/giu);
    for (const match of matches) {
      const city = normalizeCandidate(match[1] ?? "");
      if (isCityCandidate(city)) {
        result.push(city);
      }
    }
    return result;
  },
};

const cityPrefixExtractor: CityPatternExtractor = {
  id: "city-prefix",
  extract(rawText: string): string[] {
    const result: string[] = [];
    const matches = rawText.matchAll(/(?:^|[\s,;])(?:г\.|город)\s*([А-ЯЁ][а-яё-]{2,})/gimu);
    for (const match of matches) {
      const city = normalizeCandidate(match[1] ?? "");
      if (isCityCandidate(city)) {
        result.push(city);
      }
    }
    return result;
  },
};

const plainLineExtractor: CityPatternExtractor = {
  id: "plain-line",
  extract(rawText: string): string[] {
    const result: string[] = [];
    const lines = rawText.replace(/\r/g, "").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (shouldSkipLine(trimmed)) {
        continue;
      }
      const chunks = trimmed.split(",");
      for (const chunk of chunks) {
        const candidate = normalizeCandidate(chunk);
        if (isCityCandidate(candidate)) {
          result.push(candidate);
        }
      }
    }
    return result;
  },
};

const CITY_EXTRACTORS: CityPatternExtractor[] = [
  airportExtractor,
  cityPrefixExtractor,
  plainLineExtractor,
];

export function extractFallbackCities(rawText: string): string[] {
  const unique = new Set<string>();
  for (const extractor of CITY_EXTRACTORS) {
    for (const city of extractor.extract(rawText)) {
      unique.add(city);
    }
  }
  return [...unique];
}
