import type { GeoSpanToken, PlaceKindHint } from "@radar/shared";

/** Канальные формы муниципалитетов → kind hint + lookup label. */
const MUNICIPAL_PATTERN =
  /(?:^|[^\p{L}\p{N}_])([а-яёА-ЯЁ][а-яёА-ЯЁ\-]{1,50}?\s+(?:мо|МО|Мо|го|ГО|Го|район|р-н))(?=[^\p{L}\p{N}_]|$)/giu;

const CITY_PREFIX_PATTERN =
  /(?:^|[^\p{L}\p{N}_])(?:г\.?\s*)([А-ЯЁ][а-яё\-]{2,40})(?=[^\p{L}\p{N}_]|$)/gu;

function hintFromSuffix(label: string): PlaceKindHint {
  if (/\s+(?:мо|МО|Мо|го|ГО|Го|район|р-н)\s*$/iu.test(label)) {
    return "district";
  }
  return "city";
}

/** Извлекает geo-spans из groomedText (не зависит от строк). */
export function tokenizeGeoSpans(text: string): GeoSpanToken[] {
  const spans: GeoSpanToken[] = [];
  const occupied: Array<[number, number]> = [];

  const overlaps = (start: number, end: number) =>
    occupied.some(([s, e]) => start < e && end > s);

  const push = (start: number, end: number, matchedText: string, kindHint?: PlaceKindHint) => {
    if (overlaps(start, end)) return;
    occupied.push([start, end]);
    spans.push({
      start,
      end,
      matchedText,
      lookupLabel: matchedText.trim(),
      kindHint: kindHint ?? hintFromSuffix(matchedText),
    });
  };

  for (const match of text.matchAll(MUNICIPAL_PATTERN)) {
    const full = match[1]?.trim();
    if (!full) continue;
    const idx = match.index! + match[0].indexOf(full);
    push(idx, idx + full.length, full, hintFromSuffix(full));
  }

  for (const match of text.matchAll(CITY_PREFIX_PATTERN)) {
    const city = match[1]?.trim();
    if (!city) continue;
    const prefix = match[0].trim();
    const idx = match.index! + match[0].indexOf(prefix);
    push(idx, idx + prefix.length, prefix, "city");
  }

  return spans.sort((a, b) => a.start - b.start);
}
