import type { GeoSpanToken, PlaceKindHint } from "@radar/shared";

/** Канальные формы муниципалитетов → kind hint + lookup label. */
const MUNICIPAL_PATTERN =
  /(?:^|[^\p{L}\p{N}_])([а-яёА-ЯЁ][а-яёА-ЯЁ\-]{1,50}?\s+(?:мо|МО|Мо|го|ГО|Го|район|р-н))(?=[^\p{L}\p{N}_]|$)/giu;

const PREFIX_PATTERNS: Array<{ regex: RegExp; kind: PlaceKindHint; labelGroup: number }> = [
  {
    regex: /(?:^|[^\p{L}\p{N}_])(?:г\.?\s*)([А-ЯЁа-яё][а-яё\-]{2,40})(?=[^\p{L}\p{N}_]|$)/giu,
    kind: "city",
    labelGroup: 0,
  },
  {
    regex: /(?:^|[^\p{L}\p{N}_])(?:с\.?\s*)([А-ЯЁа-яё][а-яё\-]{2,40})(?=[^\p{L}\p{N}_]|$)/giu,
    kind: "city",
    labelGroup: 0,
  },
  {
    regex: /(?:^|[^\p{L}\p{N}_])(?:пос\.?\s*)([А-ЯЁа-яё][а-яё\-]{2,40})(?=[^\p{L}\p{N}_]|$)/giu,
    kind: "city",
    labelGroup: 0,
  },
  {
    regex: /(?:^|[^\p{L}\p{N}_])(?:х\.?\s*)([А-ЯЁа-яё][а-яё\-]{2,40})(?=[^\p{L}\p{N}_]|$)/giu,
    kind: "city",
    labelGroup: 0,
  },
  {
    regex: /(?:^|[^\p{L}\p{N}_])(?:б\.?\s*)([А-ЯЁа-яё][а-яё\-]{2,40})(?=[^\p{L}\p{N}_]|$)/giu,
    kind: "district",
    labelGroup: 0,
  },
];

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

  for (const { regex, kind } of PREFIX_PATTERNS) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const prefix = match[0].trim();
      const idx = match.index! + match[0].indexOf(prefix);
      push(idx, idx + prefix.length, prefix, kind);
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}
