import { normalizeRegionCodeAlias } from "@radar/shared";
import type { DadataSuggestion } from "./mapDadataSuggestion.js";

/** DaData ISO ↔ наш каталог (Севастополь, Крым). */
const DADATA_ISO_EQUIVALENTS: Record<string, string[]> = {
  "RU-SEV": ["UA-40"],
  "RU-CR": ["UA-43"],
};

/**
 * Субъекты, где DaData часто отдаёт region_iso_code=null, но подсказка валидна.
 * Принимаем только при маркерах субъекта в query/value.
 */
const WEAK_ISO_REGION_HINTS = new Set(["RU-DON", "RU-LUG"]);

const WEAK_ISO_REGION_MARKERS: Record<string, RegExp> = {
  "RU-DON": /донецк|днр|донецкая\s+народн/i,
  "RU-LUG": /луганск|лнр|луганская\s+народн/i,
};

function canonicalHint(code: string | undefined): string {
  if (!code?.trim()) return "";
  return normalizeRegionCodeAlias(code.trim().toUpperCase());
}

function pickString(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  if (value == null || value === "") return "";
  return String(value).trim();
}

function pickSuggestionPlaceToken(data: Record<string, unknown> | undefined): string {
  return (
    pickString(data, "settlement")
    || pickString(data, "city")
    || pickString(data, "area")
  );
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

/** Топоним из ответа должен фигурировать в исходном query (защита от омонимов). */
function queryMentionsPlaceToken(queryNorm: string, placeToken: string): boolean {
  const token = normalizeToken(placeToken);
  if (token.length < 3) return false;
  return queryNorm.includes(token);
}

function isoMatchesHint(dadataIso: string, hint: string): boolean {
  const canonicalDadata = canonicalHint(dadataIso);
  if (!canonicalDadata || !hint) return false;
  if (canonicalDadata === hint) return true;
  const equivalents = DADATA_ISO_EQUIVALENTS[hint] ?? [];
  return equivalents.some((code) => canonicalHint(code) === canonicalDadata);
}

function weakIsoRegionMatchesHint(input: {
  hint: string;
  queryNorm: string;
  suggestionText: string;
}): boolean {
  const marker = WEAK_ISO_REGION_MARKERS[input.hint];
  if (!marker) return false;
  return marker.test(input.queryNorm) || marker.test(input.suggestionText);
}

/**
 * Fallback без locations: подсказка согласована с ожидаемым субъектом каталога.
 */
export function isDadataSuggestionRegionConsistent(input: {
  regionCodeHint?: string;
  queryNorm: string;
  suggestion: DadataSuggestion;
}): boolean {
  const hint = canonicalHint(input.regionCodeHint);
  if (!hint) return true;

  const data = input.suggestion.data;
  const dadataIso = pickString(data, "region_iso_code");
  const suggestionText = normalizeToken(
    `${input.suggestion.value ?? ""} ${pickString(data, "region")} ${pickString(data, "region_with_type")}`,
  );

  if (dadataIso) {
    return isoMatchesHint(dadataIso, hint);
  }

  if (!WEAK_ISO_REGION_HINTS.has(hint)) {
    return false;
  }

  if (!weakIsoRegionMatchesHint({ hint, queryNorm: input.queryNorm, suggestionText })) {
    return false;
  }

  const placeToken = pickSuggestionPlaceToken(data);
  return queryMentionsPlaceToken(input.queryNorm, placeToken);
}
